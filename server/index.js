require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const multer = require("multer");
const fs = require("fs").promises;
const { Server } = require("socket.io");
const { ChatGroq } = require("@langchain/groq");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const mammoth = require("mammoth");
const pdf = require("pdf-parse");
const Tesseract = require("tesseract.js");
const sharp = require("sharp");
const cors = require("cors");
const crypto = require("crypto");
const { ExpressPeerServer } = require("peer");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

// ============ CONFIGURATION ============
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000'];
const DOCTOR_EMAIL = process.env.DOCTOR_EMAIL || 'devanku411@gmail.com';
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 10;
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 6 * 60 * 60 * 1000; // 6 hours

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: ALLOWED_ORIGINS.includes('*') ? '*' : ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  },
  maxHttpBufferSize: 1e8
});

// Socket.io rate limiting tracking
const socketRateLimits = new Map(); // IP -> { count, resetTime }

function checkSocketRateLimit(ip) {
  const now = Date.now();
  const limit = socketRateLimits.get(ip);
  
  if (!limit || now > limit.resetTime) {
    socketRateLimits.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  if (limit.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  limit.count++;
  return true;
}

// PeerJS Server for WebRTC
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: "/"
});
app.use("/peerjs", peerServer);

// ============ HEALTH CHECK ENDPOINT ============
// IMPORTANT: Must be placed BEFORE CORS middleware so ALB health checks work
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'arogyamitra-backend'
  });
});

// ============ SECURITY MIDDLEWARE ============
// Helmet - Security headers (XSS protection, clickjacking prevention, etc.)
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false, // Required for WebRTC
}));

// CORS - Restrict to allowed origins only
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (health checks, server-to-server, mobile apps)
    if (!origin) {
      return callback(null, true);
    }
    if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked request from: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Rate Limiting - 10 requests per IP, retry after 6 hours
const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  message: {
    error: 'Too many requests from this IP',
    message: 'You have exceeded the limit of 10 requests. Please try again after 6 hours.',
    retryAfter: '6 hours'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Validate: false to suppress IPv6 warning (we handle it manually)
  validate: { xForwardedForHeader: false },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

// Apply rate limiting to API routes
app.use('/api', apiLimiter);
app.use('/upload', apiLimiter);

app.use(express.json());
app.use(express.static(path.resolve("./public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Configure file upload
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads");
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// Initialize Groq LLM - Replace with your own API key
const llm = new ChatGroq({
  model: "llama-3.3-70b-versatile",
  temperature: 0.7,
  maxTokens: 2000,
  maxRetries: 2,
  apiKey: process.env.GROQ_API_KEY || ""
});

// Data structures
let rooms = {};
let users = {};
let roomInvitations = {}; // Maps hash -> { roomId, patientEmail, doctorEmail, createdAt }

// Generate secure hash link for room
function generateRoomHash() {
  return crypto.randomBytes(16).toString("hex");
}

// Emergency keywords detection
const EMERGENCY_KEYWORDS = [
  'chest pain', 'heart attack', 'can\'t breathe', 'breathless', 'severe bleeding',
  'unconscious', 'stroke', 'paralysis', 'severe headache', 'suicide',
  'overdose', 'seizure', 'choking', 'anaphylaxis', 'severe pain'
];

// AI Prompts - UPDATED WITH DOCUMENT SUMMARY CONTEXT
const PATIENT_AI_PROMPT = `You are an AI Medical Assistant helping a PATIENT. Your role:

**SAFETY-FIRST APPROACH**
1. **Empathetic Support**: Be warm, reassuring, and supportive
2. **Simple Language**: Avoid medical jargon, explain in simple terms
3. **Symptom Clarification**: Ask ONE focused question at a time
4. **No Premature Conclusions**: Never diagnose or interpret lab results
5. **Safety Boundaries**: If critical values detected, advise immediate medical attention
6. **Respond Only When**:
   - Patient asks direct questions
   - Patient is alone and needs guidance
   - Patient mentions @ai

**DOCUMENT CONTEXT**: You have access to summaries of uploaded medical documents. Use this information to provide context-aware responses, but NEVER share detailed medical interpretations with the patient. Only acknowledge the upload and reassure them that their doctor will review it.

**RISK CONTROL**: Never share detailed medical analysis. Acknowledge uploads and reassure.`;

const DOCTOR_AI_PROMPT = `You are an AI Medical Assistant helping a DOCTOR. Your role:

**CLINICAL-GRADE ANALYSIS**
1. **Detailed Insights**: Provide comprehensive medical analysis
2. **Critical Findings**: Highlight abnormal values, red flags with clinical context
3. **Medical Terminology**: Use appropriate professional language
4. **Evidence-Based**: Reference standard clinical thresholds
5. **Explainable AI**: Always explain WHY a finding is significant
6. **Respond Only When**:
   - Doctor asks about files/reports
   - Doctor mentions @ai
   - Doctor needs clinical summary

**DOCUMENT CONTEXT**: You have full access to all uploaded medical documents including detailed analysis, health metrics, and key findings. Use this comprehensive information to provide clinical insights.

**TRANSPARENCY**: Provide clear reasoning for all flagged findings with confidence levels.`;

// Extract health metrics from content
async function extractHealthMetrics(content, conversationHistory = []) {
  const recentConversation = conversationHistory.slice(-10).map(m => `${m.role}: ${m.content}`).join('\n');
  
  const metricsPrompt = `You are a medical data extraction AI. Extract ALL health metrics, vital signs, lab values, and diagnoses from the following content.

**MEDICAL FILE CONTENT**:
${content.substring(0, 3000)}

**RECENT CONVERSATION CONTEXT**:
${recentConversation}

**EXTRACTION RULES**:
1. Look for ANY numerical health values (heart rate, BP, temp, etc.)
2. Extract diagnoses, conditions, or symptoms mentioned
3. If a value is found, include it. If not found, set to 0
4. Determine risk level based on abnormal findings
5. Calculate confidence based on how explicit the data is

Respond ONLY with valid JSON (no markdown, no explanations):
{
  "vitals": {
    "heartRate": { "value": NUMBER_OR_0, "unit": "bpm", "status": "normal|elevated|low" },
    "bloodPressure": { "systolic": NUMBER_OR_0, "diastolic": NUMBER_OR_0, "status": "normal|elevated|low" },
    "temperature": { "value": NUMBER_OR_0, "unit": "°F|°C", "status": "normal|elevated|low" },
    "oxygenSaturation": { "value": NUMBER_OR_0, "unit": "%", "status": "normal|low" },
    "respiratoryRate": { "value": NUMBER_OR_0, "unit": "breaths/min", "status": "normal|elevated|low" }
  },
  "diagnosis": {
    "primary": "ACTUAL_CONDITION_NAME or 'Monitoring'",
    "confidence": NUMBER_0_TO_100,
    "riskLevel": "low|medium|high|critical",
    "summary": "2-3 sentence clinical summary of findings"
  },
  "keyFindings": [
    {
      "parameter": "Lab/Vital name",
      "value": "actual value with unit",
      "normalRange": "normal range",
      "status": "normal|abnormal",
      "concern": "why this matters clinically"
    }
  ],
  "recommendations": [
    "specific actionable recommendation"
  ]
}

CRITICAL: Extract REAL data from the content. Do not use placeholder values unless truly no data exists.`;

  try {
    const response = await llm.invoke([
      new SystemMessage("You are a medical data extractor specializing in parsing lab reports, vital signs, and clinical documents. Extract ALL numerical values and diagnoses accurately. Respond ONLY with valid JSON."),
      new HumanMessage(metricsPrompt)
    ]);

    let jsonContent = response.content.replace(/```json|```|```/g, '').trim();
    jsonContent = jsonContent.replace(/^\s+|\s+$/g, '');
    
    console.log("Raw AI response for metrics:", jsonContent.substring(0, 500));
    
    const metrics = JSON.parse(jsonContent);
    
    if (!metrics.vitals) metrics.vitals = {};
    if (!metrics.diagnosis) {
      metrics.diagnosis = {
        primary: "Monitoring",
        confidence: 0,
        riskLevel: "low",
        summary: "No specific diagnosis identified"
      };
    }
    if (!metrics.keyFindings) metrics.keyFindings = [];
    if (!metrics.recommendations) metrics.recommendations = [];
    
    console.log("Extracted metrics:", JSON.stringify(metrics, null, 2));
    return metrics;
  } catch (error) {
    console.error("Metrics extraction error:", error);
    console.error("Error details:", error.message);
    
    return {
      vitals: {},
      diagnosis: {
        primary: "Analysis Error",
        confidence: 0,
        riskLevel: "low",
        summary: "Unable to extract metrics from document"
      },
      keyFindings: [],
      recommendations: ["Please re-upload the document or check file format"]
    };
  }
}

// Explainable AI Analysis
async function analyzeFileWithXAI(content, fileName, previousReports = []) {
  const analysisPrompt = `Analyze this medical report with EXPLAINABLE AI principles:

File: ${fileName}
Content: ${content.substring(0, 3000)}

${previousReports.length > 0 ? `
**TEMPORAL CONTEXT** (Previous Reports):
${previousReports.map((r, i) => `Report ${i+1} (${r.date}): ${r.keyFindings}`).join('\n')}
` : ''}

Provide analysis in this EXACT format:

**CLINICAL SUMMARY**
• Main diagnosis/finding (1 line)

**CRITICAL FINDINGS**
• [Value/Finding]: [Normal Range] → [Current Value] → [Deviation %]
  Reason: [Clinical explanation]
  Confidence: [High/Medium/Low]

**TEMPORAL TRENDS** (if previous data available)
• [Parameter]: [Previous → Current] → [Trend Analysis]

**IMMEDIATE CONCERNS**
• [Priority level]: [Specific concern]

**RECOMMENDATIONS**
• [Actionable next steps]

Be concise, clinical, and ALWAYS explain the "why" behind findings.`;

  try {
    const analysis = await llm.invoke([
      new SystemMessage("You are a clinical AI analyzer specializing in explainable medical insights."),
      new HumanMessage(analysisPrompt)
    ]);
    return analysis.content;
  } catch (error) {
    console.error("XAI Analysis error:", error);
    return "Unable to analyze with full explainability.";
  }
}

// Temporal Health Intelligence
function extractTemporalData(room) {
  if (!room.files || room.files.length < 2) return [];
  
  return room.files.map(f => ({
    name: f.name,
    date: f.uploadedAt,
    keyFindings: f.analysis ? f.analysis.substring(0, 200) : "No analysis",
    content: f.content.substring(0, 500)
  }));
}

async function performTemporalAnalysis(currentContent, fileName, room) {
  const previousReports = extractTemporalData(room);
  
  if (previousReports.length === 0) {
    return await analyzeFileWithXAI(currentContent, fileName, []);
  }

  const temporalPrompt = `Perform TEMPORAL HEALTH INTELLIGENCE analysis:

**CURRENT REPORT**: ${fileName}
${currentContent.substring(0, 2000)}

**HISTORICAL DATA**:
${previousReports.map((r, i) => `
Report ${i+1} - ${new Date(r.date).toLocaleDateString()}:
${r.keyFindings}
`).join('\n')}

Analyze:
1. **Longitudinal Trends**: Compare current vs historical values
2. **Progression/Deterioration**: Identify gradual changes over time
3. **Early Warning Signs**: Flag subtle patterns that indicate future risk
4. **Clinical Significance**: Is this progression normal or concerning?

Format as structured clinical analysis with temporal context.`;

  try {
    const analysis = await llm.invoke([
      new SystemMessage("You are a temporal medical intelligence analyzer specializing in longitudinal health trends."),
      new HumanMessage(temporalPrompt)
    ]);
    return analysis.content;
  } catch (error) {
    console.error("Temporal analysis error:", error);
    return await analyzeFileWithXAI(currentContent, fileName, previousReports);
  }
}

// Emergency Detection
async function detectEmergency(message, userRole) {
  const messageLower = message.toLowerCase();
  
  const hasEmergencyKeyword = EMERGENCY_KEYWORDS.some(keyword => 
    messageLower.includes(keyword)
  );

  if (!hasEmergencyKeyword) return { isEmergency: false };

  const emergencyPrompt = `Analyze this message for medical emergency indicators:

Message: "${message}"

Classify emergency level:
- CRITICAL: Immediate life threat (chest pain, can't breathe, severe bleeding, stroke symptoms)
- HIGH: Urgent medical attention needed within hours
- MODERATE: Medical evaluation needed soon
- LOW: Non-emergency concern

Respond ONLY with JSON:
{
  "level": "CRITICAL|HIGH|MODERATE|LOW",
  "reasoning": "brief explanation",
  "urgentAdvice": "immediate action to take"
}`;

  try {
    const response = await llm.invoke([
      new SystemMessage("You are an emergency medical triage AI. Respond ONLY with valid JSON."),
      new HumanMessage(emergencyPrompt)
    ]);

    const result = JSON.parse(response.content.replace(/```json|```/g, '').trim());
    
    return {
      isEmergency: result.level === "CRITICAL" || result.level === "HIGH",
      level: result.level,
      reasoning: result.reasoning,
      urgentAdvice: result.urgentAdvice
    };
  } catch (error) {
    console.error("Emergency detection error:", error);
    return { isEmergency: hasEmergencyKeyword, level: "HIGH", reasoning: "Keyword detected" };
  }
}

// Generate Clinical Documentation
async function generateClinicalDocumentation(roomId) {
  const room = rooms[roomId];
  if (!room) return null;

  const conversationHistory = room.messages
    .filter(m => m.role === 'Patient' || m.role === 'Doctor')
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const filesSummary = room.files
    .map(f => `- ${f.name}: ${f.analysis || 'No analysis'}`)
    .join('\n');

  const docPrompt = `Generate structured clinical documentation from this consultation:

**CONVERSATION**:
${conversationHistory}

**UPLOADED FILES**:
${filesSummary}

Generate SOAP NOTE format:

**SUBJECTIVE**
- Chief Complaint: [main issue]
- History of Present Illness: [brief narrative]
- Review of Systems: [relevant findings]

**OBJECTIVE**
- Vital signs/Reports: [from uploaded files]
- Physical findings: [mentioned in chat]

**ASSESSMENT**
- Primary diagnosis: [clinical impression]
- Differential diagnoses: [alternatives]

**PLAN**
- Investigations: [tests ordered]
- Treatment: [medications/interventions]
- Follow-up: [next steps]

Keep concise and clinically accurate.`;

  try {
    const documentation = await llm.invoke([
      new SystemMessage("You are a medical documentation AI specializing in SOAP notes and clinical summaries."),
      new HumanMessage(docPrompt)
    ]);
    return documentation.content;
  } catch (error) {
    console.error("Documentation generation error:", error);
    return null;
  }
}

// OCR for images
async function extractTextFromImage(imagePath) {
  try {
    console.log("Starting OCR:", imagePath);
    const processedPath = imagePath + "_processed.jpg";
    await sharp(imagePath)
      .greyscale()
      .normalize()
      .sharpen()
      .toFile(processedPath);

    const { data: { text } } = await Tesseract.recognize(processedPath, 'eng');
    
    try { await fs.unlink(processedPath); } catch (e) {}
    
    console.log("OCR completed, text length:", text.length);
    return text.trim();
  } catch (error) {
    console.error("OCR Error:", error);
    return "";
  }
}

// Extract text from files
async function extractFileContent(filePath, mimeType) {
  try {
    console.log("Extracting:", filePath, mimeType);
    
    if (mimeType === "application/pdf") {
      const dataBuffer = await fs.readFile(filePath);
      const pdfData = await pdf(dataBuffer);
      return pdfData.text;
    } else if (mimeType.includes("word") || mimeType.includes("document")) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } else if (mimeType.includes("text")) {
      return await fs.readFile(filePath, "utf-8");
    } else if (mimeType.includes("image")) {
      const ocrText = await extractTextFromImage(filePath);
      return ocrText.length > 10 ? ocrText : "[Image - no text detected]";
    }
    return "[Unsupported format]";
  } catch (error) {
    console.error("Extraction error:", error);
    return "[Extraction failed]";
  }
}

// UPDATED: Generate Document Summary for AI Context
async function generateDocumentSummary(content, fileName, analysis, metrics) {
  const summary = {
    fileName: fileName,
    timestamp: new Date().toISOString(),
    briefSummary: analysis ? analysis.substring(0, 500) : "No analysis available",
    keyMetrics: {
      diagnosis: metrics?.diagnosis?.primary || "Unknown",
      riskLevel: metrics?.diagnosis?.riskLevel || "low",
      criticalFindings: metrics?.keyFindings?.slice(0, 3).map(f => `${f.parameter}: ${f.value}`) || []
    },
    fullAnalysis: analysis,
    rawContent: content.substring(0, 1000)
  };
  
  return summary;
}

// UPDATED: AI Response with role-based isolation and document context
async function getAIResponse(roomId, userMessage, userRole, socketId, isFileQuery = false, emergencyContext = null) {
  const room = rooms[roomId];
  if (!room) return "Room not found";

  // Build document context based on role
  let documentContext = "";
  
  if (room.files && room.files.length > 0) {
    if (userRole === "doctor") {
      // Doctor gets full detailed analysis
      documentContext = "\n\n**UPLOADED MEDICAL DOCUMENTS** (Full Clinical Detail):\n";
      room.files.forEach((file, idx) => {
        documentContext += `\n${idx + 1}. **${file.name}** (Uploaded: ${new Date(file.uploadedAt).toLocaleDateString()})\n`;
        if (file.documentSummary) {
          documentContext += `   - Diagnosis: ${file.documentSummary.keyMetrics.diagnosis}\n`;
          documentContext += `   - Risk Level: ${file.documentSummary.keyMetrics.riskLevel}\n`;
          documentContext += `   - Critical Findings: ${file.documentSummary.keyMetrics.criticalFindings.join(', ')}\n`;
          documentContext += `   - Analysis: ${file.documentSummary.briefSummary}\n`;
        }
        if (file.analysis) {
          documentContext += `   - Full Analysis:\n${file.analysis.substring(0, 800)}\n`;
        }
      });
    } else {
      // Patient gets minimal, reassuring context
      documentContext = "\n\n**UPLOADED DOCUMENTS** (Patient View):\n";
      room.files.forEach((file, idx) => {
        documentContext += `${idx + 1}. ${file.name} - Uploaded successfully, being reviewed by your doctor\n`;
      });
    }
  }

  const systemPrompt = userRole === "doctor" ? DOCTOR_AI_PROMPT : PATIENT_AI_PROMPT;
  
  // Filter messages to only show what this role should see
  const roleMessages = room.messages.filter(m => {
    // Show all non-AI messages
    if (m.role !== 'AI Assistant') return true;
    // For AI messages, only show if no forRole specified or if it matches current role
    return !m.forRole || m.forRole === userRole;
  });
  
  let context = `Room: ${roomId}
User Role: ${userRole}
Patient: ${room.patient || "Waiting"}
Doctor: ${room.doctor || "Not yet joined"}

${emergencyContext ? `🚨 EMERGENCY CONTEXT: ${emergencyContext.reasoning}\nLevel: ${emergencyContext.level}` : ''}

${documentContext}

Recent messages (last 5):
${roleMessages.slice(-5).map(m => `${m.role}: ${m.content}`).join("\n")}`;

  const messages = [
    new SystemMessage(systemPrompt),
    new SystemMessage(context),
    new HumanMessage(`[${userRole}]: ${userMessage}`)
  ];

  try {
    const response = await llm.invoke(messages);
    return response.content;
  } catch (error) {
    console.error("AI Error:", error);
    return "I'm having trouble responding. Please try again.";
  }
}

// ==================== API ENDPOINTS ====================

// Create room (Doctor only)
app.post("/api/create-room", (req, res) => {
  const { doctorEmail, patientEmail } = req.body;
  
  if (!doctorEmail || !patientEmail) {
    return res.status(400).json({ error: "Doctor email and Patient email are required" });
  }
  
  const roomHash = generateRoomHash();
  const roomId = `room_${Date.now()}`;
  
  // Store invitation
  roomInvitations[roomHash] = {
    roomId,
    patientEmail: patientEmail.toLowerCase(),
    doctorEmail: doctorEmail.toLowerCase(),
    createdAt: new Date().toISOString(),
    videoEnabled: false
  };
  
  // Initialize room
  rooms[roomId] = {
    messages: [],
    files: [],
    patient: null,
    doctor: null,
    patientAvatar: null,
    doctorAvatar: null,
    healthMetrics: null,
    allowedPatientEmail: patientEmail.toLowerCase(),
    doctorEmail: doctorEmail.toLowerCase(),
    videoCallActive: false,
    videoParticipants: []
  };
  
  console.log(`Room created: ${roomId} with hash: ${roomHash}`);
  console.log(`Patient invited: ${patientEmail}`);
  
  res.json({ 
    success: true, 
    roomHash, 
    roomId,
    inviteLink: `/chat/${roomHash}`
  });
});

// Validate room access
app.post("/api/validate-room", (req, res) => {
  const { roomHash, userEmail } = req.body;
  
  const invitation = roomInvitations[roomHash];
  
  if (!invitation) {
    return res.status(404).json({ error: "Invalid room link", valid: false });
  }
  
  const email = userEmail?.toLowerCase();
  const isDoctor = email === invitation.doctorEmail;
  const isInvitedPatient = email === invitation.patientEmail;
  
  if (!isDoctor && !isInvitedPatient) {
    return res.status(403).json({ 
      error: "You are not authorized to join this room", 
      valid: false 
    });
  }
  
  res.json({
    valid: true,
    roomId: invitation.roomId,
    role: isDoctor ? "doctor" : "patient",
    patientEmail: invitation.patientEmail,
    doctorEmail: invitation.doctorEmail
  });
});

// Get doctor's rooms
app.get("/api/doctor-rooms", (req, res) => {
  const { email } = req.query;
  
  // Return rooms where this email is the doctor
  const doctorRooms = Object.entries(roomInvitations)
    .filter(([_, inv]) => inv.doctorEmail === email?.toLowerCase())
    .map(([hash, inv]) => ({
      hash,
      roomId: inv.roomId,
      patientEmail: inv.patientEmail,
      createdAt: inv.createdAt,
      hasPatientJoined: rooms[inv.roomId]?.patient !== null,
      inviteLink: `/chat/${hash}`
    }));
  
  res.json({ rooms: doctorRooms });
});

// Get patient's rooms (rooms where they are invited)
app.get("/api/patient-rooms", (req, res) => {
  const { email } = req.query;
  
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }
  
  // Return rooms where this email is the invited patient
  const patientRooms = Object.entries(roomInvitations)
    .filter(([_, inv]) => inv.patientEmail === email?.toLowerCase())
    .map(([hash, inv]) => ({
      hash,
      roomId: inv.roomId,
      doctorEmail: inv.doctorEmail,
      createdAt: inv.createdAt,
      isDoctorOnline: rooms[inv.roomId]?.doctor !== null,
      inviteLink: `/chat/${hash}`
    }));
  
  res.json({ rooms: patientRooms });
});

// Delete room (Doctor only)
app.delete("/api/delete-room/:hash", (req, res) => {
  const { hash } = req.params;
  const { doctorEmail } = req.body;
  
  const invitation = roomInvitations[hash];
  
  if (!invitation) {
    return res.status(404).json({ error: "Room not found" });
  }
  
  // Verify doctor ownership
  if (invitation.doctorEmail !== doctorEmail?.toLowerCase()) {
    return res.status(403).json({ error: "Only the doctor who created this room can delete it" });
  }
  
  const roomId = invitation.roomId;
  
  // Disconnect all users in this room
  if (rooms[roomId]) {
    // Notify all connected users
    io.to(roomId).emit("room-deleted", { message: "This consultation room has been deleted by the doctor" });
    
    // Clean up room data
    delete rooms[roomId];
  }
  
  // Remove invitation
  delete roomInvitations[hash];
  
  console.log(`Room deleted: ${roomId} (hash: ${hash})`);
  
  res.json({ success: true, message: "Room deleted successfully" });
});

// File upload endpoint - UPDATED with document summary
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { roomId, uploadedBy, uploaderRole } = req.body;
    const file = req.file;

    if (!file || !roomId) {
      return res.status(400).json({ error: "File and roomId required" });
    }

    console.log("Upload:", file.originalname, "by", uploadedBy, "in", roomId);

    const content = await extractFileContent(file.path, file.mimetype);
    console.log("Content extracted, length:", content.length);

    let analysis = "";
    let metrics = null;
    let documentSummary = null;
    
    if (content && content.length > 20 && !content.includes("no text detected")) {
      console.log("Starting analysis for file:", file.originalname);
      
      if (rooms[roomId]) {
        analysis = await performTemporalAnalysis(content, file.originalname, rooms[roomId]);
        
        console.log("Extracting health metrics from file...");
        metrics = await extractHealthMetrics(content, rooms[roomId].messages);
        
        // Generate document summary for AI context
        documentSummary = await generateDocumentSummary(content, file.originalname, analysis, metrics);
        
        console.log("Metrics extracted successfully:", JSON.stringify(metrics, null, 2));
        
        rooms[roomId].healthMetrics = metrics;
        
        console.log("Broadcasting health metrics to room:", roomId);
        io.to(roomId).emit("health-metrics-updated", { metrics });
      } else {
        analysis = await analyzeFileWithXAI(content, file.originalname, []);
        metrics = await extractHealthMetrics(content, []);
        documentSummary = await generateDocumentSummary(content, file.originalname, analysis, metrics);
      }
    } else {
      console.log("Content too short or invalid for analysis");
    }

    const fileInfo = {
      name: file.originalname,
      path: file.path,
      url: `/uploads/${file.filename}`,
      type: file.mimetype,
      content: content.substring(0, 5000),
      analysis: analysis,
      documentSummary: documentSummary, // NEW: Store document summary
      uploadedAt: new Date().toISOString(),
      uploadedBy: uploadedBy || "Unknown"
    };

    if (rooms[roomId]) {
      rooms[roomId].files.push(fileInfo);
      
      const fileMessage = {
        role: uploadedBy || "User",
        nickname: uploadedBy,
        content: `📎 Uploaded: ${file.originalname}`,
        timestamp: new Date().toISOString(),
        fileData: {
          name: file.originalname,
          url: fileInfo.url,
          type: file.mimetype,
          analysis: analysis
        },
        isFile: true
      };

      rooms[roomId].messages.push(fileMessage);
      io.to(roomId).emit("chat-message", fileMessage);
      io.to(roomId).emit("files-updated", { files: rooms[roomId].files });

      // Send AI analysis to doctor ONLY (with forRole tag)
      if (content && content.length > 20) {
        setTimeout(() => {
          const doctorSocketId = Object.keys(users).find(
            sid => users[sid].roomId === roomId && users[sid].role === "doctor"
          );
          
          if (doctorSocketId && rooms[roomId].doctor) {
            const doctorAiMessage = {
              role: 'AI Assistant',
              content: `🔬 **Clinical Analysis** (with XAI)\n\n${analysis}`,
              timestamp: new Date().toISOString(),
              forRole: 'doctor', // CRITICAL: Mark as doctor-only
              isPrivate: true
            };
            
            // Store in messages with forRole tag
            rooms[roomId].messages.push(doctorAiMessage);
            
            // Send only to doctor
            io.to(doctorSocketId).emit("ai-message", { 
              message: doctorAiMessage.content,
              isPrivate: true,
              forRole: "doctor"
            });
          }
        }, 1000);
      }

      // Send patient-friendly message to patient ONLY
      if (uploaderRole === "patient") {
        setTimeout(() => {
          const patientSocketId = Object.keys(users).find(
            sid => users[sid].nickname === uploadedBy && users[sid].roomId === roomId
          );
          
          if (patientSocketId) {
            const patientAiMessage = {
              role: 'AI Assistant',
              content: `✅ I've received "${file.originalname}". Your doctor will review it shortly.`,
              timestamp: new Date().toISOString(),
              forRole: 'patient', // CRITICAL: Mark as patient-only
              isPrivate: true
            };
            
            // Store in messages with forRole tag
            rooms[roomId].messages.push(patientAiMessage);
            
            // Send only to patient
            io.to(patientSocketId).emit("ai-message", { 
              message: patientAiMessage.content,
              isPrivate: true,
              forRole: "patient"
            });
          }
        }, 500);
      }
    }

    res.json({ success: true, file: fileInfo });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ==================== SOCKET.IO ====================

io.on("connection", async (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", ({ roomId, nickname, role, avatarUrl, email }) => {
    socket.join(roomId);
    
    if (!rooms[roomId]) {
      rooms[roomId] = {
        messages: [],
        files: [],
        patient: null,
        doctor: null,
        patientAvatar: null,
        doctorAvatar: null,
        healthMetrics: null,
        videoCallActive: false,
        videoParticipants: []
      };
    }

    users[socket.id] = { roomId, nickname, role, avatarUrl, email };
    
    if (role === "patient") {
      rooms[roomId].patient = nickname;
      rooms[roomId].patientAvatar = avatarUrl;
    } else {
      rooms[roomId].doctor = nickname;
      rooms[roomId].doctorAvatar = avatarUrl;
    }

    // UPDATED: Filter messages by role before sending history
    const filteredMessages = rooms[roomId].messages.filter(m => {
      if (m.role !== 'AI Assistant') return true;
      return !m.forRole || m.forRole === role;
    });

    socket.emit("room-history", {
      messages: filteredMessages,
      files: rooms[roomId].files
    });

    if (rooms[roomId].healthMetrics) {
      socket.emit("health-metrics-updated", { metrics: rooms[roomId].healthMetrics });
    }

    // Check if video call is active
    if (rooms[roomId].videoCallActive) {
      socket.emit("video-call-active", { active: true });
    }

    io.to(roomId).emit("user-joined", {
      nickname,
      role,
      patient: rooms[roomId].patient,
      doctor: rooms[roomId].doctor,
      patientAvatar: rooms[roomId].patientAvatar,
      doctorAvatar: rooms[roomId].doctorAvatar
    });

    console.log(`${nickname} (${role}) joined room ${roomId}`);
  });

  // Video call events
  socket.on("start-video-call", ({ roomId }) => {
    const user = users[socket.id];
    if (!user || user.role !== "doctor") {
      socket.emit("video-error", { message: "Only doctors can start video calls" });
      return;
    }
    
    if (rooms[roomId]) {
      rooms[roomId].videoCallActive = true;
      rooms[roomId].videoParticipants = [];
      io.to(roomId).emit("video-call-started", { 
        startedBy: user.nickname,
        roomId 
      });
      console.log(`Video call started in room ${roomId} by ${user.nickname}`);
    }
  });

  socket.on("join-video-call", ({ roomId, peerId }) => {
    const user = users[socket.id];
    if (!user || !rooms[roomId]) return;
    
    // Add to participants
    if (!rooms[roomId].videoParticipants.includes(peerId)) {
      rooms[roomId].videoParticipants.push(peerId);
    }
    
    // Notify others in the room about new video participant
    socket.to(roomId).emit("user-joined-video", { 
      peerId, 
      nickname: user.nickname,
      role: user.role 
    });
    
    // Send list of existing participants to the new joiner
    socket.emit("existing-video-participants", { 
      participants: rooms[roomId].videoParticipants.filter(id => id !== peerId) 
    });
    
    console.log(`${user.nickname} joined video call with peerId: ${peerId}`);
  });

  socket.on("end-video-call", ({ roomId }) => {
    const user = users[socket.id];
    if (!user || user.role !== "doctor") return;
    
    if (rooms[roomId]) {
      rooms[roomId].videoCallActive = false;
      rooms[roomId].videoParticipants = [];
      io.to(roomId).emit("video-call-ended", { endedBy: user.nickname });
      console.log(`Video call ended in room ${roomId}`);
    }
  });

  socket.on("leave-video-call", ({ roomId, peerId }) => {
    const user = users[socket.id];
    if (!user || !rooms[roomId]) return;
    
    rooms[roomId].videoParticipants = rooms[roomId].videoParticipants.filter(id => id !== peerId);
    socket.to(roomId).emit("user-left-video", { peerId, nickname: user.nickname });
  });

  // UPDATED: Chat message handler with role-based AI isolation
  socket.on("chat-message", async ({ roomId, message, avatarUrl }) => {
    const user = users[socket.id];
    if (!user) return;

    const isAiCall = message.toLowerCase().includes("@ai");

    const chatMessage = {
      role: user.role === "doctor" ? "Doctor" : "Patient",
      nickname: user.nickname,
      content: message,
      timestamp: new Date().toISOString(),
      avatarUrl: avatarUrl || user.avatarUrl
    };

    // Store message
    rooms[roomId].messages.push(chatMessage);

    // 🚫 DO NOT broadcast @ai messages
    if (!isAiCall) {
      io.to(roomId).emit("chat-message", chatMessage);
    } else {
      // Send @ai message ONLY to sender
      io.to(socket.id).emit("chat-message", chatMessage);
    }

    // 🤖 AI RESPONSE (PRIVATE)
    if (isAiCall) {
      const aiResponse = await getAIResponse(
        roomId,
        message,
        user.role,
        socket.id
      );

      const aiMessage = {
        role: "AI Assistant",
        content: aiResponse,
        timestamp: new Date().toISOString(),
        forRole: user.role,
        isPrivate: true
      };

      rooms[roomId].messages.push(aiMessage);

      // 🚨 Send AI reply ONLY to requester
      io.to(socket.id).emit("ai-message", {
        message: aiResponse,
        forRole: user.role,
        isPrivate: true
      });
    }
  });

  socket.on("typing", ({ roomId }) => {
    const user = users[socket.id];
    if (user) {
      socket.to(roomId).emit("user-typing", { nickname: user.nickname });
    }
  });

  socket.on("request-documentation", async ({ roomId }) => {
    const documentation = await generateClinicalDocumentation(roomId);
    if (documentation) {
      socket.emit("documentation-generated", { documentation });
    }
  });

  socket.on("disconnect", () => {
    const user = users[socket.id];
    if (user) {
      const { roomId, nickname, role } = user;
      
      if (rooms[roomId]) {
        if (role === "patient") {
          rooms[roomId].patient = null;
          rooms[roomId].patientAvatar = null;
        } else {
          rooms[roomId].doctor = null;
          rooms[roomId].doctorAvatar = null;
        }
        
        io.to(roomId).emit("user-left", {
          nickname,
          role,
          patient: rooms[roomId].patient,
          doctor: rooms[roomId].doctor
        });
      }
      
      delete users[socket.id];
      console.log(`${nickname} disconnected`);
    }
  });
});

const PORT = process.env.PORT || 9000;
server.listen(PORT, () => {
  console.log(`ArogyaMitra Server running on port ${PORT}`);
  console.log(`PeerJS Server available at /peerjs`);
});