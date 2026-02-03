"use client";

import React, { useState, useEffect, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import Peer from 'peerjs';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/contexts/AuthContext';

// Configuration from environment variables
const DOCTOR_EMAIL = process.env.NEXT_PUBLIC_DOCTOR_EMAIL || 'devanku411@gmail.com';
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:9000';

interface Message {
  role: string;
  nickname?: string;
  content: string;
  timestamp: string;
  fileData?: {
    name: string;
    url: string;
    type: string;
    analysis?: string;
  };
  isFile?: boolean;
  forRole?: string;
  isEmergency?: boolean;
  avatarUrl?: string;
}

interface FileInfo {
  name: string;
  url: string;
  type?: string;
  analysis?: string;
  uploadedAt?: string;
}

interface RoomParticipants {
  patient: string | null;
  doctor: string | null;
  patientAvatar?: string | null;
  doctorAvatar?: string | null;
}

interface HealthMetrics {
  vitals: {
    heartRate?: { value: number; unit: string; status: string };
    bloodPressure?: { systolic: number; diastolic: number; status: string };
    temperature?: { value: number; unit: string; status: string };
    oxygenSaturation?: { value: number; unit: string; status: string };
    respiratoryRate?: { value: number; unit: string; status: string };
  };
  diagnosis: {
    primary: string;
    confidence: number;
    riskLevel: string;
    summary: string;
  };
  keyFindings: Array<{
    parameter: string;
    value: string;
    normalRange: string;
    status: string;
    concern: string;
  }>;
  recommendations: string[];
}

interface VideoParticipant {
  peerId: string;
  nickname: string;
  role: string;
  stream?: MediaStream;
}

export default function MedicalChatPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = use(params);
  const { user, isLoading: authLoading, logout } = useAuth();

  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState('');
  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState<'patient' | 'doctor'>('patient');
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [participants, setParticipants] = useState<RoomParticipants>({ patient: null, doctor: null });
  const [isTyping, setIsTyping] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [showDocumentation, setShowDocumentation] = useState(false);
  const [documentation, setDocumentation] = useState<string>('');
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [activeTab, setActiveTab] = useState<'ai' | 'files' | 'info'>('ai');
  const [healthMetrics, setHealthMetrics] = useState<HealthMetrics>({
    vitals: {},
    diagnosis: {
      primary: "Awaiting Data",
      confidence: 0,
      riskLevel: "low",
      summary: "Upload medical reports to begin analysis"
    },
    keyFindings: [],
    recommendations: []
  });

  // Auth state
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [validatingRoom, setValidatingRoom] = useState(true);
  const [roomError, setRoomError] = useState<string | null>(null);
  const router = useRouter();

  // Video call state
  const [videoCallActive, setVideoCallActive] = useState(false);
  const [inVideoCall, setInVideoCall] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, VideoParticipant>>(new Map());
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const peerRef = useRef<Peer | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check auth and validate room on mount
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.push('/auth/login');
      return;
    }

    const validateRoom = async () => {
      // Determine role based on email
      const isDoctor = user.email?.toLowerCase() === DOCTOR_EMAIL.toLowerCase() || user.email?.toLowerCase() === 'doctor@demo.com';
      setRole(isDoctor ? 'doctor' : 'patient');

      // Set nickname from user metadata or email
      const fullName = user.full_name || user.email?.split('@')[0] || 'User';
      setNickname(fullName);

      // Set avatar URL
      const avatar = user.avatar_url ||
        `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(fullName)}&backgroundColor=${isDoctor ? '10b981' : '3b82f6'}`;
      setAvatarUrl(avatar);

      // Validate room access
      try {
        const response = await fetch(`${SERVER_URL}/api/validate-room`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomHash: hash, userEmail: user.email })
        });

        const data = await response.json();

        if (!data.valid) {
          setRoomError(data.error || 'Invalid room link');
          setValidatingRoom(false);
          return;
        }

        setRoomId(data.roomId);
        setValidatingRoom(false);
      } catch (error) {
        console.error('Room validation error:', error);
        setRoomError('Could not connect to server');
        setValidatingRoom(false);
      }
    };

    validateRoom();
  }, [user, authLoading, router, hash]);

  // Connect socket when room is validated
  useEffect(() => {
    if (!roomId || validatingRoom) return;

    const newSocket = io(SERVER_URL);
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [roomId, validatingRoom]);

  useEffect(() => {
    if (!socket) return;

    socket.on('room-history', ({ messages: historyMessages, files: historyFiles }) => {
      setMessages(historyMessages);
      setFiles(historyFiles);
    });

    socket.on('user-joined', ({ nickname: joinedNickname, role: joinedRole, patient, doctor, patientAvatar, doctorAvatar }) => {
      setParticipants({ patient, doctor, patientAvatar, doctorAvatar });
      const joinMessage: Message = {
        role: 'System',
        content: `${joinedNickname} (${joinedRole}) joined`,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, joinMessage]);
    });

    socket.on('user-left', ({ nickname: leftNickname, role: leftRole, patient, doctor }) => {
      setParticipants(prev => ({ ...prev, patient, doctor }));
      const leaveMessage: Message = {
        role: 'System',
        content: `${leftNickname} (${leftRole}) left`,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, leaveMessage]);
    });

    socket.on('chat-message', (message: Message) => {
      setMessages(prev => [...prev, message]);

      if (message.isEmergency) {
        setEmergencyMode(true);
      }
    });

    socket.on('ai-message', ({ message, forRole }) => {
      // 🚫 BLOCK if role mismatch
      if (forRole && forRole !== role) return;

      const aiMessage: Message = {
        role: 'AI Assistant',
        content: message,
        timestamp: new Date().toISOString()
      };

      if (message.isEmergency) {
        setEmergencyMode(true);
      }

      setMessages(prev => [...prev, aiMessage]);
    });


    socket.on('files-updated', ({ files: updatedFiles }) => {
      setFiles(updatedFiles);
    });

    socket.on('health-metrics-updated', ({ metrics }) => {
      setHealthMetrics(metrics);
    });

    socket.on('user-typing', ({ nickname: typingNickname }) => {
      setIsTyping(`${typingNickname} is typing...`);
      setTimeout(() => setIsTyping(''), 2000);
    });

    socket.on('documentation-generated', ({ documentation: doc }) => {
      setDocumentation(doc);
      setShowDocumentation(true);
      setGeneratingDoc(false);
    });

    // Video call events
    socket.on('video-call-started', ({ startedBy }) => {
      setVideoCallActive(true);
      const systemMsg: Message = {
        role: 'System',
        content: `Video call started by ${startedBy}`,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, systemMsg]);
    });

    socket.on('video-call-ended', ({ endedBy }) => {
      setVideoCallActive(false);
      setInVideoCall(false);
      cleanupVideoCall();
      const systemMsg: Message = {
        role: 'System',
        content: `Video call ended by ${endedBy}`,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, systemMsg]);
    });

    socket.on('video-call-active', ({ active }) => {
      setVideoCallActive(active);
    });

    socket.on('user-joined-video', ({ peerId, nickname: peerNickname, role: peerRole }) => {
      if (peerRef.current && localStream) {
        const call = peerRef.current.call(peerId, localStream);
        call.on('stream', (remoteStream) => {
          setRemoteStreams(prev => {
            const newMap = new Map(prev);
            newMap.set(peerId, { peerId, nickname: peerNickname, role: peerRole, stream: remoteStream });
            return newMap;
          });
        });
      }
    });

    socket.on('existing-video-participants', ({ participants: existingPeers }) => {
      // Will connect when they call us
    });

    socket.on('user-left-video', ({ peerId }) => {
      setRemoteStreams(prev => {
        const newMap = new Map(prev);
        newMap.delete(peerId);
        return newMap;
      });
    });

    return () => {
      socket.off('room-history');
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('chat-message');
      socket.off('ai-message');
      socket.off('files-updated');
      socket.off('health-metrics-updated');
      socket.off('user-typing');
      socket.off('documentation-generated');
      socket.off('video-call-started');
      socket.off('video-call-ended');
      socket.off('video-call-active');
      socket.off('user-joined-video');
      socket.off('existing-video-participants');
      socket.off('user-left-video');
    };
  }, [socket, localStream]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-join room when socket and roomId are ready
  useEffect(() => {
    if (socket && roomId && nickname && !joined) {
      socket.emit('join-room', { roomId, nickname, role, avatarUrl, email: user?.email });
      setJoined(true);
    }
  }, [socket, roomId, nickname, role, avatarUrl, joined, user?.email]);

  const cleanupVideoCall = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setRemoteStreams(new Map());
    setInVideoCall(false);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
  };

  const startVideoCall = async () => {
    if (role !== 'doctor') return;
    socket?.emit('start-video-call', { roomId });
  };

  const joinVideoCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Parse server URL for PeerJS configuration
      const serverUrl = new URL(SERVER_URL);
      const peer = new Peer({
        host: serverUrl.hostname,
        port: parseInt(serverUrl.port) || (serverUrl.protocol === 'https:' ? 443 : 80),
        path: '/peerjs',
        secure: serverUrl.protocol === 'https:'
      });

      peer.on('open', (id) => {
        socket?.emit('join-video-call', { roomId, peerId: id });
      });

      peer.on('call', (call) => {
        call.answer(stream);
        call.on('stream', (remoteStream) => {
          setRemoteStreams(prev => {
            const newMap = new Map(prev);
            newMap.set(call.peer, { peerId: call.peer, nickname: 'Participant', role: 'unknown', stream: remoteStream });
            return newMap;
          });
        });
      });

      peerRef.current = peer;
      setInVideoCall(true);
    } catch (error) {
      console.error('Error joining video call:', error);
      alert('Could not access camera/microphone');
    }
  };

  const leaveVideoCall = () => {
    if (peerRef.current) {
      socket?.emit('leave-video-call', { roomId, peerId: peerRef.current.id });
    }
    cleanupVideoCall();
  };

  const endVideoCall = () => {
    socket?.emit('end-video-call', { roomId });
    cleanupVideoCall();
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];

        if (localStream) {
          const videoTrack = localStream.getVideoTracks()[0];
          localStream.removeTrack(videoTrack);
          localStream.addTrack(screenTrack);

          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream;
          }
        }

        screenTrack.onended = () => {
          setIsScreenSharing(false);
        };

        setIsScreenSharing(true);
      } else {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const videoTrack = videoStream.getVideoTracks()[0];

        if (localStream) {
          const screenTrack = localStream.getVideoTracks()[0];
          localStream.removeTrack(screenTrack);
          localStream.addTrack(videoTrack);

          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream;
          }
        }

        setIsScreenSharing(false);
      }
    } catch (error) {
      console.error('Screen sharing error:', error);
    }
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !socket) return;

    socket.emit('chat-message', { roomId, message: inputMessage, avatarUrl });
    setInputMessage('');
  };

  const handleTyping = () => {
    if (socket) {
      socket.emit('typing', { roomId });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setImagePreview(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setImagePreview(null);
      }
    }
  };

  const uploadFile = async () => {
    if (!selectedFile) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('roomId', roomId);
    formData.append('uploadedBy', nickname);
    formData.append('uploaderRole', role);

    try {
      const response = await fetch(`${SERVER_URL}/upload`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        setSelectedFile(null);
        setImagePreview(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } else {
        const error = await response.json();
        alert(`Upload failed: ${error.error}`);
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert('File upload failed');
    } finally {
      setUploading(false);
    }
  };

  const generateDocumentation = () => {
    if (!socket) return;
    setGeneratingDoc(true);
    socket.emit('request-documentation', { roomId });
  };

  const downloadDocumentation = () => {
    const blob = new Blob([documentation], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clinical-note-${roomId}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSignOut = async () => {
    await logout();
    router.push('/auth/login');
  };

  const copyInviteLink = () => {
    const link = `${window.location.origin}/chat/${hash}`;
    navigator.clipboard.writeText(link);
    alert('Invite link copied to clipboard!');
  };

  const getFileIcon = (fileType: string) => {
    if (fileType?.includes('pdf')) {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    } else if (fileType?.includes('word') || fileType?.includes('document')) {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    } else if (fileType?.includes('image')) {
      return (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    }
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
      </svg>
    );
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'normal': return 'text-emerald-600';
      case 'elevated':
      case 'high': return 'text-orange-600';
      case 'critical': return 'text-red-600';
      case 'low': return 'text-blue-600';
      default: return 'text-[#4a403a]';
    }
  };

  const getRiskLevelColor = (riskLevel: string) => {
    switch (riskLevel?.toLowerCase()) {
      case 'low': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'medium': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      case 'high': return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'critical': return 'bg-red-50 text-red-700 border-red-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const renderFileInChat = (fileData: Message['fileData'], isOwn: boolean) => {
    if (!fileData) return null;

    const isImage = fileData.type?.startsWith('image/');
    const isPDF = fileData.type === 'application/pdf';
    const fullUrl = `${SERVER_URL}${fileData.url}`;

    return (
      <div className="mt-3">
        <div className="flex items-center gap-2 mb-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          <span className="font-semibold text-sm">{fileData.name}</span>
        </div>

        {isImage && (
          <div className="relative group mt-2">
            <img
              src={fullUrl || "/placeholder.svg"}
              alt={fileData.name}
              className="max-w-xs max-h-96 rounded-2xl cursor-pointer hover:opacity-95 transition-all shadow-lg object-contain"
              onClick={() => setExpandedImage(fullUrl)}
            />
          </div>
        )}

        {!isImage && (
          <div className={`p-4 rounded-xl ${isOwn ? 'bg-white/20' : 'bg-stone-100'} border border-stone-200 mt-2 flex items-center gap-3 hover:shadow-md transition-all cursor-pointer`}>
            <div className="text-[#e87c63]">{getFileIcon(fileData.type || '')}</div>
            <div className="flex-1">
              <p className="font-medium text-sm">{fileData.name}</p>
              <p className="text-xs opacity-70 mt-1">
                {isPDF ? 'PDF Document' : 'Document'}
              </p>
            </div>
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg bg-white/50 hover:bg-white/70 transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        )}
      </div>
    );
  };

  // Loading state
  if (authLoading || validatingRoom) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#FFFAF8] via-[#FFF5F2] to-[#FFEBE5] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#FFAB91] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-[#636E72] font-medium">Validating room access...</p>
        </div>
      </div>
    );
  }

  // Room error state
  if (roomError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#FFFAF8] via-[#FFF5F2] to-[#FFEBE5] flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-[#2D3436] mb-2">Access Denied</h2>
          <p className="text-[#636E72] mb-6">{roomError}</p>
          <button
            onClick={() => router.push('/chat')}
            className="bg-[#FFAB91] hover:bg-[#FF9A7B] text-white px-6 py-3 rounded-full font-semibold transition-all"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Main Chat Interface
  return (
    <div className="h-screen bg-[#FFFAF8] flex flex-col overflow-hidden">
      {emergencyMode && (
        <div className="bg-[#FDF2F0] border-b border-[#c25e48]/20 px-6 py-3 flex items-center justify-between text-[#c25e48] text-sm font-medium animate-pulse">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Emergency Mode Active: Priority routing enabled.</span>
          </div>
          <button
            onClick={() => setEmergencyMode(false)}
            className="text-[#c25e48] hover:text-red-700 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Video Call Overlay */}
      {inVideoCall && (
        <div className="fixed inset-0 bg-gradient-to-br from-[#FFFAF8] via-[#FFF5F2] to-[#FFEBE5] z-50 flex flex-col">
          {/* Video Call Header */}
          <div className="bg-white/80 backdrop-blur-md border-b border-stone-200 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#ff9e88] rounded-lg flex items-center justify-center text-white">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#4a403a]">Video Consultation</h2>
                <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium">
                  <span className="block w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                  SECURE CONNECTION
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#8c817a]">
                {participants.patient && participants.doctor ? '2 participants' : '1 participant'}
              </span>
            </div>
          </div>

          {/* Video Grid */}
          <div className="flex-1 p-6">
            <div className={`h-full ${remoteStreams.size === 0 ? 'grid-cols-1' : 'grid grid-cols-2'} gap-4`}>
              {/* Remote Video(s) */}
              {Array.from(remoteStreams.values()).map((participant) => (
                <div key={participant.peerId} className="relative bg-gradient-to-br from-stone-100 to-stone-50 rounded-3xl overflow-hidden shadow-xl border-2 border-stone-200">
                  <video
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                    ref={(el) => {
                      if (el && participant.stream) {
                        el.srcObject = participant.stream;
                        remoteVideoRefs.current.set(participant.peerId, el);
                      }
                    }}
                  />
                  {/* Participant Name Tag */}
                  <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-md px-4 py-2 rounded-xl shadow-lg border border-stone-200">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                      <span className="text-sm font-bold text-[#4a403a]">{participant.nickname}</span>
                    </div>
                  </div>
                  {/* Gradient Overlay */}
                  <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>
                </div>
              ))}

              {/* Local Video (Self View) */}
              {remoteStreams.size === 0 ? (
                <div className="relative bg-gradient-to-br from-stone-100 to-stone-50 rounded-3xl overflow-hidden shadow-xl border-2 border-stone-200">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className={`w-full h-full object-cover ${isVideoOff ? 'hidden' : ''}`}
                  />
                  {isVideoOff && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#ff9e88] to-[#e87c63]">
                      <div className="w-32 h-32 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white text-5xl font-bold border-4 border-white/30">
                        {nickname.charAt(0).toUpperCase()}
                      </div>
                    </div>
                  )}
                  <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-md px-4 py-2 rounded-xl shadow-lg border border-stone-200">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                      <span className="text-sm font-bold text-[#4a403a]">You {isMuted && '(Muted)'}</span>
                    </div>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>
                </div>
              ) : (
                // PiP View when remote participant exists
                <div className="absolute bottom-24 right-8 w-72 aspect-video bg-gradient-to-br from-stone-100 to-stone-50 rounded-2xl overflow-hidden shadow-2xl border-2 border-white z-10">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className={`w-full h-full object-cover ${isVideoOff ? 'hidden' : ''}`}
                  />
                  {isVideoOff && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#ff9e88] to-[#e87c63]">
                      <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white text-3xl font-bold border-4 border-white/30">
                        {nickname.charAt(0).toUpperCase()}
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 bg-white/90 backdrop-blur-md px-3 py-1 rounded-lg text-xs font-bold text-[#4a403a]">
                    You {isMuted && '(Muted)'}
                  </div>
                </div>
              )}

              {remoteStreams.size === 0 && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-[#ff9e88]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-[#ff9e88]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                    <p className="text-[#8c817a] font-medium">Waiting for others to join...</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Floating Controls Bar */}
          <div className="pb-8 flex items-center justify-center">
            <div className="bg-white/80 backdrop-blur-md shadow-2xl rounded-full px-6 py-4 flex items-center gap-3 border border-stone-200">
              {/* Mute Button */}
              <button
                onClick={toggleMute}
                className={`relative group p-4 rounded-full transition-all ${isMuted
                  ? 'bg-red-500 text-white shadow-lg'
                  : 'bg-[#fffaf8] text-[#4a403a] hover:bg-stone-100'
                  }`}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-[#4a403a] text-white text-xs px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {isMuted ? 'Unmute' : 'Mute'}
                </div>
              </button>

              {/* Video Toggle Button */}
              <button
                onClick={toggleVideo}
                className={`relative group p-4 rounded-full transition-all ${isVideoOff
                  ? 'bg-red-500 text-white shadow-lg'
                  : 'bg-[#fffaf8] text-[#4a403a] hover:bg-stone-100'
                  }`}
                title={isVideoOff ? 'Turn On Video' : 'Turn Off Video'}
              >
                {isVideoOff ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-[#4a403a] text-white text-xs px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {isVideoOff ? 'Start Video' : 'Stop Video'}
                </div>
              </button>

              {/* Screen Share Button */}
              <button
                onClick={toggleScreenShare}
                className={`relative group p-4 rounded-full transition-all ${isScreenSharing
                  ? 'bg-[#ff9e88] text-white shadow-lg'
                  : 'bg-[#fffaf8] text-[#4a403a] hover:bg-stone-100'
                  }`}
                title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-[#4a403a] text-white text-xs px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
                </div>
              </button>

              <div className="w-px h-8 bg-stone-300 mx-2"></div>

              {/* End Call Button */}
              <button
                onClick={role === 'doctor' ? endVideoCall : leaveVideoCall}
                className="relative group px-6 py-4 rounded-full bg-red-500 hover:bg-red-600 text-white font-bold shadow-lg transition-all flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
                </svg>
                <span className="text-sm">End Call</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expanded Image Modal */}
      {expandedImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8"
          onClick={() => setExpandedImage(null)}
        >
          <img src={expandedImage || "/placeholder.svg"} alt="Expanded" className="max-w-full max-h-full object-contain rounded-2xl" />
          <button
            className="absolute top-6 right-6 text-white hover:text-gray-300"
            onClick={() => setExpandedImage(null)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Documentation Modal */}
      {showDocumentation && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-8">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-stone-200 flex items-center justify-between">
              <h3 className="text-xl font-bold text-[#4a403a]">Clinical Documentation (SOAP)</h3>
              <button onClick={() => setShowDocumentation(false)} className="text-[#8c817a] hover:text-[#4a403a]">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <pre className="whitespace-pre-wrap text-sm text-[#4a403a] font-mono bg-[#fffaf8] p-4 rounded-xl">
                {documentation}
              </pre>
            </div>
            <div className="p-6 border-t border-stone-200 flex justify-end gap-3">
              <button
                onClick={downloadDocumentation}
                className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2 rounded-full font-semibold transition-all"
              >
                Download
              </button>
              <button
                onClick={() => setShowDocumentation(false)}
                className="bg-stone-200 hover:bg-stone-300 text-[#4a403a] px-6 py-2 rounded-full font-semibold transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 bg-white border-r border-stone-200 flex flex-col flex-shrink-0">
          <div className="h-16 flex items-center gap-3 px-6 border-b border-stone-200">
            <div className="w-8 h-8 bg-[#ff9e88] rounded-lg flex items-center justify-center text-white">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h1 className="text-lg font-bold tracking-tight text-[#4a403a]">ArogyaMitra</h1>
          </div>

          <div className="p-4 border-b border-stone-200">
            <div className="flex items-center gap-3">
              <div className="relative">
                <img
                  src={avatarUrl || "/placeholder.svg"}
                  alt={nickname}
                  className="w-10 h-10 rounded-full object-cover border-2 border-stone-100"
                />
                <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${role === 'doctor' ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
              </div>
              <div>
                <p className="font-bold text-sm text-[#4a403a]">{nickname}</p>
                <p className="text-xs text-[#8c817a]">{role === 'doctor' ? 'Doctor' : 'Patient'}</p>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-1 overflow-y-auto flex-1">
            <div className="mb-6">
              <p className="px-3 text-xs font-semibold text-[#8c817a] uppercase tracking-wider mb-2">Room</p>
              <div className="px-3 py-2 bg-[#fffaf8] rounded-lg">
                <p className="text-xs text-[#8c817a] font-mono truncate">{hash.substring(0, 16)}...</p>
              </div>
              {role === 'doctor' && (
                <button
                  onClick={copyInviteLink}
                  className="mt-2 w-full flex items-center justify-center gap-2 text-[#ff9e88] hover:text-[#e87c63] text-sm font-medium"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                  Copy Invite Link
                </button>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between px-3 mb-2">
                <p className="text-xs font-semibold text-[#8c817a] uppercase tracking-wider">Participants</p>
                <span className="bg-[#ff9e88]/20 text-[#e87c63] text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                  {(participants.patient ? 1 : 0) + (participants.doctor ? 1 : 0)}
                </span>
              </div>

              {participants.doctor && (
                <div className="flex items-center gap-3 px-3 py-2 text-[#4a403a] hover:bg-[#fffaf8] rounded-xl transition-colors mb-1 cursor-pointer">
                  <div className="relative">
                    <img
                      src={participants.doctorAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(participants.doctor)}&backgroundColor=10b981`}
                      alt={participants.doctor}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{participants.doctor}</p>
                    <p className="text-xs text-emerald-600 font-medium">Doctor</p>
                  </div>
                </div>
              )}

              {participants.patient && (
                <div className="flex items-center gap-3 px-3 py-3 bg-[#fff5f1] text-[#4a403a] rounded-xl transition-colors border border-[#ff9e88]/20 mb-1">
                  <div className="relative">
                    <img
                      src={participants.patientAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(participants.patient)}&backgroundColor=3b82f6`}
                      alt={participants.patient}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{participants.patient}</p>
                    <p className="text-xs opacity-80 text-blue-600 font-medium">Patient</p>
                  </div>
                </div>
              )}

              {!participants.patient && role === 'doctor' && (
                <div className="px-3 py-4 text-center text-[#8c817a] text-sm">
                  <p>Waiting for patient to join...</p>
                </div>
              )}
            </div>
          </div>

          <div className="p-4 border-t border-stone-200 space-y-2">
            <button
              onClick={() => router.push('/chat')}
              className="w-full flex items-center justify-center gap-2 bg-[#ff9e88] hover:bg-[#e87c63] text-white h-10 rounded-full text-sm font-bold transition-colors shadow-lg shadow-[#ff9e88]/30"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
              </svg>
              Dashboard
            </button>
            <button
              onClick={handleSignOut}
              className="w-full flex items-center justify-center gap-2 bg-transparent hover:bg-red-50 text-red-500 h-10 rounded-full text-sm font-medium transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign Out
            </button>
          </div>
        </aside>

        {/* Main Chat Area */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#fffaf8] relative">
          <header className="bg-white h-16 border-b border-stone-200 px-6 flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-lg font-bold text-[#4a403a] flex items-center gap-2">
                {participants.patient || 'Waiting for patient'}
                {healthMetrics.diagnosis.riskLevel !== 'low' && healthMetrics.diagnosis.riskLevel && (
                  <span className={`px-2 py-0.5 rounded-md text-xs font-bold uppercase tracking-wide ${getRiskLevelColor(healthMetrics.diagnosis.riskLevel)}`}>
                    {healthMetrics.diagnosis.riskLevel} Priority
                  </span>
                )}
              </h2>
              <p className="text-xs text-[#8c817a]">
                {participants.patient && participants.doctor ? '2 participants' : '1 participant'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Video Call Buttons */}
              {role === 'doctor' && !videoCallActive && (
                <button
                  onClick={startVideoCall}
                  className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-full text-sm font-bold transition-all shadow-lg"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Start Video
                </button>
              )}

              {videoCallActive && !inVideoCall && (
                <button
                  onClick={joinVideoCall}
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-full text-sm font-bold transition-all shadow-lg animate-pulse"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Join Video Call
                </button>
              )}

              {role === 'doctor' && (
                <button
                  onClick={generateDocumentation}
                  disabled={generatingDoc}
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-full text-sm font-bold transition-all shadow-lg shadow-emerald-500/30 disabled:opacity-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>{generatingDoc ? 'Generating...' : 'SOAP'}</span>
                </button>
              )}
              <button
                onClick={() => setShowSidebar(!showSidebar)}
                className="w-9 h-9 rounded-full bg-[#fffaf8] hover:bg-stone-200 flex items-center justify-center text-[#4a403a] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                </svg>
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="flex justify-center">
              <span className="bg-stone-200 text-[#8c817a] text-xs px-3 py-1 rounded-full font-medium">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </span>
            </div>

            {messages.map((msg, idx) => {
              const isOwn = msg.nickname === nickname;
              const isSystem = msg.role === 'System';
              const isAI = msg.role === 'AI Assistant';

              if (isSystem) {
                return (
                  <div key={idx} className="flex justify-center my-4">
                    <div className="bg-gradient-to-r from-stone-200 to-stone-300 text-[#4a403a] text-xs px-4 py-2 rounded-full shadow-sm">
                      {msg.content}
                    </div>
                  </div>
                );
              }

              if (isAI) {
                return (
                  <div key={idx} className="flex justify-center w-full px-12">
                    <div className="bg-stone-50 border border-stone-200 p-4 rounded-xl flex gap-3 max-w-2xl w-full shadow-sm">
                      <div className="w-8 h-8 rounded-full bg-stone-200 text-stone-600 flex items-center justify-center shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-sm font-bold text-stone-800">AI Analysis Insight</span>
                          <span className="text-xs font-medium text-stone-500">Confidence: {healthMetrics.diagnosis.confidence}%</span>
                        </div>
                        <div className="text-sm text-stone-700 leading-relaxed prose prose-sm max-w-none">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div key={idx} className={`flex ${isOwn ? 'flex-row-reverse' : 'flex-row'} gap-4`}>
                  <img
                    src={msg.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(msg.nickname || 'U')}&backgroundColor=ff9e88`}
                    alt={msg.nickname || 'User'}
                    className="w-8 h-8 rounded-full object-cover shrink-0 self-end mb-1"
                  />
                  <div className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'} max-w-[75%]`}>
                    <span className="text-xs text-[#8c817a] mx-1">
                      {msg.nickname || msg.role} - {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div className={`p-4 rounded-2xl ${isOwn
                      ? 'bg-[#ff9e88] text-white rounded-br-none'
                      : 'bg-white text-[#4a403a] border border-stone-200 rounded-bl-none'
                      } shadow-sm text-sm leading-relaxed`}>
                      {!msg.isFile && (
                        <div className="prose prose-sm max-w-none">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                      {msg.isFile && (
                        <>
                          <p className="mb-1">{msg.content}</p>
                          {renderFileInChat(msg.fileData, isOwn)}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {isTyping && (
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-stone-300 to-stone-400 shrink-0"></div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-[#8c817a] ml-1">{isTyping}</span>
                  <div className="p-4 bg-white border border-stone-200 rounded-2xl rounded-bl-none shadow-sm">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-[#8c817a] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 bg-[#8c817a] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 bg-[#8c817a] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 bg-white border-t border-stone-200">
            <div className="bg-[#fffaf8] rounded-2xl p-2 flex flex-col gap-2 border border-transparent focus-within:border-[#ff9e88]/30 focus-within:ring-4 focus-within:ring-[#ff9e88]/5 transition-all">
              <textarea
                value={inputMessage}
                onChange={(e) => {
                  setInputMessage(e.target.value);
                  handleTyping();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(e);
                  }
                }}
                placeholder="Type your message here... (Type '@ai' for AI assistance)"
                className="w-full bg-transparent border-none focus:ring-0 text-[#4a403a] placeholder:text-[#8c817a]/70 resize-none px-3 py-2 text-sm outline-none"
                rows={2}
              />
              <div className="flex items-center justify-between px-2 pb-1">
                <div className="flex items-center gap-1 text-[#8c817a]">
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileSelect}
                    accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 hover:bg-stone-200 rounded-lg transition-colors"
                    title="Attach File"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </button>
                </div>
                <button
                  onClick={sendMessage}
                  disabled={!inputMessage.trim()}
                  className="bg-[#ff9e88] hover:bg-[#e87c63] text-white px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 transition-colors shadow-lg shadow-[#ff9e88]/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>Send</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {selectedFile && (
            <div className="bg-gradient-to-r from-[#fff5f1] to-[#FFEBE5] border-t-2 border-[#ff9e88]/30 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {imagePreview ? (
                    <img src={imagePreview || "/placeholder.svg"} alt="Preview" className="w-16 h-16 object-cover rounded-lg shadow-md border-2 border-white" />
                  ) : (
                    <div className="w-16 h-16 bg-white rounded-lg flex items-center justify-center shadow-md text-[#e87c63]">
                      {getFileIcon(selectedFile.type)}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-semibold text-[#4a403a]">{selectedFile.name}</p>
                    <p className="text-xs text-[#8c817a]">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={uploadFile}
                    disabled={uploading}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold shadow-lg transition-all disabled:opacity-50"
                  >
                    {uploading ? 'Uploading...' : 'Send File'}
                  </button>
                  <button
                    onClick={() => {
                      setSelectedFile(null);
                      setImagePreview(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="text-[#8c817a] hover:text-red-500 p-2 hover:bg-white rounded-lg transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Right Sidebar - Health Metrics Panel */}
        {showSidebar && (
          <aside className="w-[340px] bg-white border-l border-stone-200 flex flex-col flex-shrink-0 overflow-y-auto">
            <div className="flex items-center p-1 m-4 bg-[#fffaf8] rounded-xl">
              <button
                onClick={() => setActiveTab('ai')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg text-center transition-all ${activeTab === 'ai' ? 'bg-white text-[#4a403a] shadow-sm' : 'text-[#8c817a] hover:text-[#4a403a]'
                  }`}
              >
                AI Analysis
              </button>
              <button
                onClick={() => setActiveTab('files')}
                className={`flex-1 py-1.5 text-xs font-medium text-center transition-all ${activeTab === 'files' ? 'bg-white text-[#4a403a] shadow-sm font-bold rounded-lg' : 'text-[#8c817a] hover:text-[#4a403a]'
                  }`}
              >
                Files
              </button>
              <button
                onClick={() => setActiveTab('info')}
                className={`flex-1 py-1.5 text-xs font-medium text-center transition-all ${activeTab === 'info' ? 'bg-white text-[#4a403a] shadow-sm font-bold rounded-lg' : 'text-[#8c817a] hover:text-[#4a403a]'
                  }`}
              >
                Info
              </button>
            </div>

            <div className="flex-1 px-4 pb-6 space-y-6">
              {activeTab === 'ai' && (
                <>
                  {/* Vital Signs */}
                  {Object.keys(healthMetrics.vitals).length > 0 ? (
                    <div className="grid grid-cols-2 gap-3">
                      {healthMetrics.vitals.heartRate && healthMetrics.vitals.heartRate.value > 0 && (
                        <div className="bg-[#fffaf8] p-3 rounded-2xl border border-stone-200">
                          <div className="flex items-center gap-2 mb-2 text-[#8c817a]">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#c25e48]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                            </svg>
                            <span className="text-xs font-semibold">Heart Rate</span>
                          </div>
                          <p className={`text-xl font-bold ${getStatusColor(healthMetrics.vitals.heartRate.status)}`}>
                            {healthMetrics.vitals.heartRate.value} <span className="text-sm font-normal text-[#8c817a]">{healthMetrics.vitals.heartRate.unit}</span>
                          </p>
                        </div>
                      )}

                      {healthMetrics.vitals.bloodPressure && healthMetrics.vitals.bloodPressure.systolic > 0 && (
                        <div className="bg-[#fffaf8] p-3 rounded-2xl border border-stone-200">
                          <div className="flex items-center gap-2 mb-2 text-[#8c817a]">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#e87c63]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                            </svg>
                            <span className="text-xs font-semibold">Blood Pressure</span>
                          </div>
                          <p className={`text-xl font-bold ${getStatusColor(healthMetrics.vitals.bloodPressure.status)}`}>
                            {healthMetrics.vitals.bloodPressure.systolic}/{healthMetrics.vitals.bloodPressure.diastolic}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-[#fffaf8] p-6 rounded-2xl border border-stone-200 text-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 mx-auto text-[#8c817a]/30 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      <p className="text-sm text-[#8c817a] font-medium">No vital signs data yet</p>
                      <p className="text-xs text-[#8c817a]/70 mt-1">Upload a medical report to see metrics</p>
                    </div>
                  )}

                  {/* Diagnosis Card */}
                  <div className="bg-gradient-to-br from-[#fdf2f0] to-white rounded-2xl border border-[#c25e48]/10 p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-[#c25e48]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      <h3 className="font-bold text-sm text-[#4a403a]">Live Diagnostic Insight</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[#8c817a]">Condition</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded border ${getRiskLevelColor(healthMetrics.diagnosis.riskLevel)}`}>
                          {healthMetrics.diagnosis.riskLevel}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[#4a403a]">{healthMetrics.diagnosis.primary}</p>
                        {healthMetrics.diagnosis.confidence > 0 && (
                          <>
                            <div className="w-full bg-stone-200 rounded-full h-1.5 mt-1.5">
                              <div
                                className="bg-[#c25e48] h-1.5 rounded-full transition-all"
                                style={{ width: `${healthMetrics.diagnosis.confidence}%` }}
                              ></div>
                            </div>
                            <p className="text-[10px] text-[#8c817a] mt-1 text-right">
                              {healthMetrics.diagnosis.confidence}% confidence
                            </p>
                          </>
                        )}
                      </div>
                      {healthMetrics.diagnosis.summary && (
                        <div className="pt-2 border-t border-[#c25e48]/10">
                          <p className="text-xs text-[#8c817a] leading-snug">
                            <strong className="text-[#c25e48]">Summary:</strong> {healthMetrics.diagnosis.summary}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'files' && (
                <div>
                  <h3 className="font-bold text-sm text-[#4a403a] mb-3">Recent Documents</h3>
                  <div className="space-y-2">
                    {files.length === 0 ? (
                      <div className="text-center text-[#8c817a] py-8">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 mx-auto opacity-30 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-sm">No files uploaded yet</p>
                      </div>
                    ) : (
                      files.map((file, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-3 p-2 rounded-xl hover:bg-[#fffaf8] transition-colors border border-transparent hover:border-stone-200 group cursor-pointer"
                        >
                          <div className="w-10 h-10 rounded-lg bg-[#fff5f1] text-[#e87c63] flex items-center justify-center shrink-0">
                            {getFileIcon(file.type || '')}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[#4a403a] truncate">{file.name}</p>
                            <p className="text-xs text-[#8c817a]">
                              {file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString() : 'Unknown'}
                            </p>
                          </div>
                          <a
                            href={`${SERVER_URL}${file.url}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8c817a] hover:text-[#4a403a]"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              {activeTab === 'info' && (
                <div className="space-y-4">
                  <div className="bg-[#fffaf8] p-4 rounded-2xl border border-stone-200">
                    <h4 className="font-bold text-sm text-[#4a403a] mb-2">Room Information</h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-[#8c817a]">Room ID</span>
                        <span className="font-mono text-[#4a403a]">{roomId}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#8c817a]">Hash</span>
                        <span className="font-mono text-[#4a403a] truncate max-w-[150px]">{hash}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#8c817a]">Your Role</span>
                        <span className={`font-bold ${role === 'doctor' ? 'text-emerald-600' : 'text-blue-600'}`}>
                          {role.charAt(0).toUpperCase() + role.slice(1)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                    <h4 className="font-bold text-sm text-blue-700 mb-2">Tips</h4>
                    <ul className="text-xs text-blue-600 space-y-1">
                      <li>Type @ai in chat for AI assistance</li>
                      <li>Upload reports for auto-analysis</li>
                      {role === 'doctor' && <li>Use SOAP button for documentation</li>}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}