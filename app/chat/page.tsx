"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// Configuration from environment variables
const DOCTOR_EMAIL = process.env.NEXT_PUBLIC_DOCTOR_EMAIL || 'devanku411@gmail.com';
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:9000';

interface RoomInvitation {
  hash: string;
  roomId: string;
  patientEmail: string;
  createdAt: string;
  hasPatientJoined: boolean;
  inviteLink: string;
}

interface PatientRoom {
  hash: string;
  roomId: string;
  doctorEmail: string;
  createdAt: string;
  isDoctorOnline: boolean;
  inviteLink: string;
}

export default function ChatDashboard() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const [role, setRole] = useState<'patient' | 'doctor'>('patient');
  const [nickname, setNickname] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomInvitation[]>([]);
  const [patientRooms, setPatientRooms] = useState<PatientRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  // Create room form
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [patientEmail, setPatientEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<{ hash: string; inviteLink: string } | null>(null);

  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.push('/auth/login');
      return;
    }

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

    // Fetch rooms based on role
    if (isDoctor) {
      fetchDoctorRooms(user.email!);
    } else {
      fetchPatientRooms(user.email!);
    }
  }, [user, authLoading, router]);

  const fetchDoctorRooms = async (email: string) => {
    setLoadingRooms(true);
    try {
      const response = await fetch(`${SERVER_URL}/api/doctor-rooms?email=${encodeURIComponent(email)}`);

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Backend server not responding. Make sure it is running on port 9000.');
      }

      const data = await response.json();
      if (data.rooms) {
        setRooms(data.rooms);
      }
    } catch (error) {
      console.error('Error fetching rooms:', error);
      alert(error instanceof Error ? error.message : 'Failed to fetch rooms');
    } finally {
      setLoadingRooms(false);
    }
  };

  const fetchPatientRooms = async (email: string) => {
    setLoadingRooms(true);
    try {
      const response = await fetch(`${SERVER_URL}/api/patient-rooms?email=${encodeURIComponent(email)}`);

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Backend server not responding. Make sure it is running on port 9000.');
      }

      const data = await response.json();
      if (data.rooms) {
        setPatientRooms(data.rooms);
      }
    } catch (error) {
      console.error('Error fetching patient rooms:', error);
      // Don't show alert for patients - just silently fail
    } finally {
      setLoadingRooms(false);
    }
  };

  const createRoom = async () => {
    if (!patientEmail || !user?.email) return;

    setCreating(true);
    try {
      const response = await fetch(`${SERVER_URL}/api/create-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorEmail: user.email,
          patientEmail: patientEmail.trim()
        })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Server returned non-JSON response. Make sure the backend server is running on port 9000.');
      }

      const data = await response.json();

      if (data.success) {
        setCreatedRoom({ hash: data.roomHash, inviteLink: data.inviteLink });
        setPatientEmail('');
        // Refresh rooms list
        fetchDoctorRooms(user.email);
      } else {
        alert(data.error || 'Failed to create room');
      }
    } catch (error) {
      console.error('Error creating room:', error);
      alert(error instanceof Error ? error.message : 'Failed to create room. Is the server running on port 9000?');
    } finally {
      setCreating(false);
    }
  };

  const copyInviteLink = (hash: string) => {
    const link = `${window.location.origin}/chat/${hash}`;
    navigator.clipboard.writeText(link);
    alert('Invite link copied to clipboard!');
  };

  const deleteRoom = async (hash: string, patientEmail: string) => {
    if (!user?.email) return;

    const confirmed = confirm(`Are you sure you want to delete the consultation room with ${patientEmail}? This action cannot be undone.`);
    if (!confirmed) return;

    try {
      const response = await fetch(`${SERVER_URL}/api/delete-room/${hash}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorEmail: user.email })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Backend server not responding properly');
      }

      const data = await response.json();

      if (data.success) {
        // Refresh rooms list
        fetchDoctorRooms(user.email);
        alert('Room deleted successfully');
      } else {
        alert(data.error || 'Failed to delete room');
      }
    } catch (error) {
      console.error('Error deleting room:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete room');
    }
  };

  const handleSignOut = async () => {
    await logout();
    router.push('/auth/login');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#FFF8F5] via-[#FFF5F2] to-[#FFEBE5] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#f48434] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-[#1c130d] font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FFF8F5] via-[#FFF5F2] to-[#FFEBE5]">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-[#f4ece7] px-6 py-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#f48434]/10 rounded-xl flex items-center justify-center text-[#f48434]">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#1c130d] tracking-tight">Arogya Mitra</h1>
              <p className="text-xs text-[#9c6c49]">Secure Medical Consultations</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={nickname}
                  className="w-10 h-10 rounded-full object-cover border-2 border-[#f48434]/20"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-200 animate-pulse" />
              )}
              <div className="hidden sm:block">
                <p className="text-sm font-bold text-[#1c130d]">{nickname}</p>
                <p className={`text-xs font-medium ${role === 'doctor' ? 'text-emerald-600' : 'text-blue-600'}`}>
                  {role === 'doctor' ? 'Doctor' : 'Patient'}
                </p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 text-red-500 hover:text-red-600 text-sm font-medium"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        {/* Welcome Card */}
        <div className="bg-white rounded-2xl shadow-lg p-8 mb-8 border border-[#f4ece7]">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <h2 className="text-3xl font-bold text-[#1c130d] mb-2 tracking-tight">
                Welcome back, {nickname}!
              </h2>
              <p className="text-[#9c6c49]">
                {role === 'doctor'
                  ? 'Create consultation rooms and invite patients for secure video consultations.'
                  : 'Join consultation rooms invited by your doctor.'
                }
              </p>
            </div>

            {role === 'doctor' && (
              <button
                onClick={() => setShowCreateRoom(true)}
                className="flex items-center gap-2 bg-gradient-to-r from-[#f48434] to-[#f69d5c] hover:from-[#e07325] hover:to-[#f48434] text-white px-6 py-3 rounded-full font-bold transition-all shadow-lg shadow-[#f48434]/30 transform hover:scale-105"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create New Room
              </button>
            )}
          </div>
        </div>

        {/* Doctor: Create Room Modal */}
        {showCreateRoom && role === 'doctor' && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 border border-[#f4ece7] animate-in fade-in zoom-in duration-200">
              {!createdRoom ? (
                <>
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-[#f48434]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-[#f48434]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold text-[#1c130d]">Create Consultation Room</h3>
                    <p className="text-sm text-[#9c6c49] mt-1">Enter the patient's email to generate a secure invite link</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-semibold text-[#1c130d] mb-2 block">Patient Email</label>
                      <input
                        type="email"
                        value={patientEmail}
                        onChange={(e) => setPatientEmail(e.target.value)}
                        placeholder="patient@example.com"
                        className="w-full h-12 px-4 rounded-xl bg-[#FFF8F5] border-2 border-transparent focus:border-[#f48434] outline-none text-[#1c130d] transition-all"
                      />
                    </div>

                    <div className="flex gap-3 pt-4">
                      <button
                        onClick={() => setShowCreateRoom(false)}
                        className="flex-1 h-12 bg-[#f4ece7] hover:bg-[#e8d9ce] text-[#1c130d] rounded-full font-semibold transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={createRoom}
                        disabled={!patientEmail || creating}
                        className="flex-1 h-12 bg-gradient-to-r from-[#f48434] to-[#f69d5c] hover:from-[#e07325] hover:to-[#f48434] text-white rounded-full font-bold transition-all disabled:opacity-50 shadow-lg"
                      >
                        {creating ? 'Creating...' : 'Create Room'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold text-[#1c130d]">Room Created!</h3>
                    <p className="text-sm text-[#9c6c49] mt-1">Share this link with your patient</p>
                  </div>

                  <div className="bg-[#FFF8F5] p-4 rounded-xl mb-6 border border-[#f4ece7]">
                    <p className="text-xs text-[#9c6c49] mb-1">Invite Link</p>
                    <p className="text-sm font-mono text-[#1c130d] break-all">
                      {window.location.origin}{createdRoom.inviteLink}
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setCreatedRoom(null);
                        setShowCreateRoom(false);
                      }}
                      className="flex-1 h-12 bg-[#f4ece7] hover:bg-[#e8d9ce] text-[#1c130d] rounded-full font-semibold transition-all"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => copyInviteLink(createdRoom.hash)}
                      className="flex-1 h-12 bg-[#f48434] hover:bg-[#e07325] text-white rounded-full font-bold transition-all flex items-center justify-center gap-2 shadow-lg"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      Copy Link
                    </button>
                    <button
                      onClick={() => router.push(`/chat/${createdRoom.hash}`)}
                      className="flex-1 h-12 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full font-bold transition-all shadow-lg"
                    >
                      Enter Room
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Doctor: Rooms List */}
        {role === 'doctor' && (
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-[#f4ece7]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-[#1c130d]">Your Consultation Rooms</h3>
              <button
                onClick={() => fetchDoctorRooms(user?.email || '')}
                className="text-[#9c6c49] hover:text-[#1c130d] p-2 rounded-lg hover:bg-[#FFF8F5] transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {loadingRooms ? (
              <div className="text-center py-12">
                <div className="w-8 h-8 border-4 border-[#f48434] border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-[#9c6c49] mt-2">Loading rooms...</p>
              </div>
            ) : rooms.length === 0 ? (
              <div className="text-center py-12">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 text-[#f4ece7] mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <p className="text-[#9c6c49] font-medium">No rooms created yet</p>
                <p className="text-sm text-[#9c6c49]/70 mt-1">Create your first consultation room to get started</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {rooms.map((room) => (
                  <div
                    key={room.hash}
                    className="bg-white rounded-xl p-5 border border-[#f4ece7] hover:border-[#f48434]/50 hover:shadow-md transition-all"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${room.hasPatientJoined
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-amber-50 text-amber-700'
                        }`}>
                        <span className={`w-2 h-2 rounded-full ${room.hasPatientJoined ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                          }`}></span>
                        {room.hasPatientJoined ? 'Joined' : 'Waiting'}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 mb-4">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${room.hasPatientJoined ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                        }`}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-[#1c130d] truncate">{room.patientEmail}</p>
                        <p className="text-xs text-[#9c6c49]">
                          Created {new Date(room.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => copyInviteLink(room.hash)}
                        className="p-2 text-[#9c6c49] hover:text-[#f48434] hover:bg-[#FFF8F5] rounded-lg transition-all"
                        title="Copy invite link"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                      </button>
                      <button
                        onClick={() => deleteRoom(room.hash, room.patientEmail)}
                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="Delete room"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                      <button
                        onClick={() => router.push(`/chat/${room.hash}`)}
                        className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-[#f48434] to-[#f69d5c] hover:from-[#e07325] hover:to-[#f48434] text-white px-4 py-2 rounded-full text-sm font-bold transition-all shadow-md"
                      >
                        Enter
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Patient: Instructions */}
        {role === 'patient' && (
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-[#f4ece7]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-[#1c130d]">Your Consultation Rooms</h3>
              <button
                onClick={() => fetchPatientRooms(user?.email || '')}
                className="text-[#9c6c49] hover:text-[#1c130d] p-2 rounded-lg hover:bg-[#FFF8F5] transition-all"
                title="Refresh rooms"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {loadingRooms ? (
              <div className="text-center py-12">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-[#9c6c49] mt-2">Loading rooms...</p>
              </div>
            ) : patientRooms.length === 0 ? (
              <div className="text-center py-12 max-w-md mx-auto">
                <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h4 className="text-xl font-bold text-[#1c130d] mb-3">No Consultations Yet</h4>
                <p className="text-[#9c6c49] mb-6">
                  Your doctor will create a consultation room for you.
                  Once created, it will appear here automatically.
                </p>
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                  <p className="text-sm text-blue-700">
                    <strong>Your email:</strong> {user?.email}
                  </p>
                  <p className="text-xs text-blue-600 mt-2">
                    Share this email with your doctor to receive consultation invites.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {patientRooms.map((room) => (
                  <div
                    key={room.hash}
                    className="bg-white rounded-xl p-5 border border-[#f4ece7] hover:border-blue-400/50 hover:shadow-md transition-all"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${room.isDoctorOnline
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-gray-50 text-gray-600'
                        }`}>
                        <span className={`w-2 h-2 rounded-full ${room.isDoctorOnline ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'
                          }`}></span>
                        {room.isDoctorOnline ? 'Doctor Online' : 'Doctor Offline'}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center bg-emerald-100 text-emerald-600">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-[#1c130d] truncate">Dr. {room.doctorEmail.split('@')[0]}</p>
                        <p className="text-xs text-[#9c6c49]">
                          Created {new Date(room.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => router.push(`/chat/${room.hash}`)}
                      className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-4 py-3 rounded-full text-sm font-bold transition-all shadow-md"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Join Consultation
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}