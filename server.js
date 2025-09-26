const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enhanced CORS configuration for Railway
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3001', 
    'https://your-frontend-domain.com',
    'https://your-app.vercel.app',
    'https://your-app.netlify.app',
    // Add your actual frontend domain here
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control'
  ],
  credentials: true,
  optionsSuccessStatus: 200 // For legacy browser support
};

app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting - more lenient for development
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Increased limit
  message: { 
    success: false,
    error: 'Too many requests, please try again later.' 
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'CareerFlow Scholarship API is running!',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      scholarships: '/api/search-scholarships'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'CareerFlow Scholarship API',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    apiKey: process.env.PERPLEXITY_API_KEY ? 'configured' : 'missing'
  });
});

// Enhanced scholarship search endpoint
app.post('/api/search-scholarships', async (req, res) => {
  console.log('📝 Scholarship search request received');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  console.log('Request headers:', req.headers);
  
  try {
    const { collegeName, course, location, gpa, category, budget } = req.body;

    // Enhanced input validation
    if (!collegeName || collegeName.trim().length === 0) {
      console.log('❌ Missing college name');
      return res.status(400).json({
        success: false,
        error: 'College name is required',
        received: { collegeName, course, location }
      });
    }

    if (!course || course.trim().length === 0) {
      console.log('❌ Missing course');
      return res.status(400).json({
        success: false,
        error: 'Course is required',
        received: { collegeName, course, location }
      });
    }

    // Check API key
    if (!process.env.PERPLEXITY_API_KEY) {
      console.error('❌ PERPLEXITY_API_KEY not found in environment');
      return res.status(500).json({
        success: false,
        error: 'Server configuration error - API key not configured',
        debug: process.env.NODE_ENV === 'development' ? 'PERPLEXITY_API_KEY missing' : undefined
      });
    }

    // Build enhanced search query
    const query = buildEnhancedQuery({
      collegeName: collegeName.trim(),
      course: course.trim(),
      location: location?.trim(),
      gpa: gpa?.trim(),
      category: category?.trim(),
      budget: budget?.trim()
    });

    console.log('🔍 Searching with query:', query);
    console.log('🔑 API Key present:', process.env.PERPLEXITY_API_KEY?.substring(0, 10) + '...');

    // Enhanced Perplexity API call
    const perplexityResponse = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model: 'sonar-small-online',
        messages: [
          {
            role: 'system',
            content: `You are an expert Indian education scholarship advisor. 
            Provide accurate, current scholarship information specifically for Indian students.
            Focus on government schemes, private foundations, and institutional scholarships available in India.
            Always provide specific amounts, eligibility criteria, deadlines, and application links when available.
            Format your response clearly with scholarship names, amounts, eligibility, and deadlines.`
          },
          {
            role: 'user',
            content: query
          }
        ],
        max_tokens: 2500,
        temperature: 0.2,
        top_p: 0.9,
        top_k: 0,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 45000, // Increased timeout
        validateStatus: function (status) {
          return status < 500; // Resolve only if the status code is less than 500
        }
      }
    );

    console.log('📊 Perplexity API Response Status:', perplexityResponse.status);

    if (perplexityResponse.status !== 200) {
      console.error('❌ Perplexity API Error:', perplexityResponse.status, perplexityResponse.data);
      throw new Error(`Perplexity API returned status ${perplexityResponse.status}`);
    }

    if (!perplexityResponse.data?.choices?.[0]?.message?.content) {
      console.error('❌ Invalid Perplexity API response structure:', perplexityResponse.data);
      throw new Error('Invalid response from AI service');
    }

    console.log('✅ Got valid response from Perplexity API');
    console.log('Response length:', perplexityResponse.data.choices[0].message.content.length);

    // Parse and structure the response
    const scholarships = parseScholarshipResponse(
      perplexityResponse.data.choices[0].message.content
    );
    
    console.log(`📊 Successfully parsed ${scholarships.length} scholarships`);

    // Return successful response
    const response = {
      success: true,
      scholarships: scholarships,
      total: scholarships.length,
      searchParams: { collegeName, course, location, gpa, category, budget },
      timestamp: new Date().toISOString()
    };

    console.log('✅ Sending successful response');
    res.json(response);

  } catch (error) {
    console.error('❌ Error in scholarship search:', error);
    
    // Enhanced error handling
    let errorMessage = 'Failed to search scholarships. Please try again.';
    let statusCode = 500;

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      errorMessage = 'Search request timed out. Please try again.';
      statusCode = 408;
    } else if (error.response?.status === 401) {
      errorMessage = 'API authentication failed. Please contact support.';
      statusCode = 500;
      console.error('🔑 API Key issue - check PERPLEXITY_API_KEY');
    } else if (error.response?.status === 429) {
      errorMessage = 'Too many requests. Please wait and try again.';
      statusCode = 429;
    } else if (error.response?.status === 400) {
      errorMessage = 'Invalid request format. Please check your input.';
      statusCode = 400;
    }

    const errorResponse = {
      success: false,
      error: errorMessage,
      timestamp: new Date().toISOString()
    };

    // Add debug info in development
    if (process.env.NODE_ENV === 'development') {
      errorResponse.debug = {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      };
    }

    res.status(statusCode).json(errorResponse);
  }
});

// Enhanced query builder
function buildEnhancedQuery({ collegeName, course, location, gpa, category, budget }) {
  let query = `Find current active scholarships and financial aid opportunities for ${course} students in India`;
  
  if (collegeName) {
    query += ` studying at ${collegeName}`;
  }
  
  if (location) {
    query += ` in ${location} state/region`;
  }
  
  if (category) {
    query += `. Focus specifically on ${category} scholarships`;
  }
  
  if (budget) {
    query += ` with funding amount in range ${budget}`;
  }
  
  if (gpa) {
    query += `. Student has academic performance of ${gpa}`;
  }
  
  query += `. 

Please provide:
1. Government scholarships (central and state government schemes)
2. Private foundation and corporate scholarships
3. Institution-specific scholarships and grants
4. International scholarships for Indian students

For each scholarship, include:
- Exact scholarship name
- Amount/value in Indian Rupees
- Specific eligibility criteria
- Application deadline for 2025-2026 academic year
- Official website or application portal link

Focus on scholarships with upcoming deadlines and active application processes.`;
  
  return query;
}

// Enhanced scholarship response parser
function parseScholarshipResponse(responseText) {
  const scholarships = [];
  
  try {
    console.log('🔄 Parsing scholarship response...');
    
    // Split by common scholarship delimiters
    const sections = responseText.split(/(?=\d+\.|\n##|\*\*[A-Z].*[Ss]cholarship|\n[A-Z].*[Ss]cholarship|\n- [A-Z])/);
    
    for (let i = 0; i < sections.length && scholarships.length < 10; i++) {
      const section = sections[i].trim();
      if (section.length < 100) continue; // Skip very short sections
      
      const scholarship = extractScholarshipInfo(section);
      
      // Enhanced validation
      if (scholarship.name && 
          scholarship.name.length > 8 && 
          scholarship.name.length < 200 &&
          !scholarship.name.toLowerCase().includes('here are') &&
          !scholarship.name.toLowerCase().includes('following') &&
          (scholarship.name.toLowerCase().includes('scholarship') || 
           scholarship.name.toLowerCase().includes('grant') ||
           scholarship.name.toLowerCase().includes('fellowship') ||
           scholarship.name.toLowerCase().includes('award') ||
           scholarship.name.toLowerCase().includes('scheme'))) {
        scholarships.push(scholarship);
      }
    }
    
    // Add reliable fallback scholarships if none found
    if (scholarships.length === 0) {
      console.log('⚠️ No scholarships parsed, adding fallback options');
      scholarships.push(
        {
          name: 'National Scholarship Portal (NSP)',
          amount: '₹12,000 - ₹2,00,000 per year',
          eligibility: 'Various categories including merit-based, need-based, SC/ST, OBC, and minority students',
          deadline: 'Multiple deadlines (Usually October to December 2025)',
          description: 'Government of India\'s centralized platform offering various scholarship schemes for students across different categories and educational levels.',
          link: 'https://scholarships.gov.in'
        },
        {
          name: 'Post Matric Scholarship Scheme for SC Students',
          amount: '₹230 - ₹1,200 per month + academic fees',
          eligibility: 'SC students pursuing post-matriculation studies with family income below ₹2.5 lakh',
          deadline: 'November 30, 2025',
          description: 'Central government scheme providing financial assistance to SC students for higher education.',
          link: 'https://scholarships.gov.in'
        },
        {
          name: 'Merit cum Means Scholarship for Professional Courses',
          amount: '₹20,000 per year',
          eligibility: 'Students with family income below ₹2.5 lakh and good academic record (80% or above)',
          deadline: 'December 31, 2025',
          description: 'UGC scheme for economically weaker students pursuing professional courses.',
          link: 'https://scholarships.gov.in'
        },
        {
          name: 'Inspire Scholarship for Higher Education',
          amount: '₹80,000 per year',
          eligibility: 'Top 1% students in Class XII board examination pursuing B.Sc./B.S./B.Tech./Integrated M.Sc.',
          deadline: 'July 31, 2025',
          description: 'DST scheme to attract talented students to pursue careers in science and technology.',
          link: 'https://online-inspire.gov.in'
        }
      );
    }
    
    console.log(`✅ Successfully parsed ${scholarships.length} scholarships`);
    
  } catch (error) {
    console.error('❌ Error parsing scholarship response:', error);
  }
  
  return scholarships.slice(0, 8); // Return top 8 scholarships
}

function extractScholarshipInfo(text) {
  return {
    name: extractScholarshipName(text),
    amount: extractAmount(text),
    eligibility: extractEligibility(text),
    deadline: extractDeadline(text),
    description: extractDescription(text),
    link: extractLink(text) || 'https://scholarships.gov.in'
  };
}

function extractScholarshipName(text) {
  const patterns = [
    /(?:\d+\.|\*\*|##)\s*([^.\n]+(?:[Ss]cholarship|[Gg]rant|[Ff]ellowship|[Aa]ward|[Ss]cheme|[Yy]ojana))/i,
    /([A-Z][A-Za-z\s&-]{8,60}(?:[Ss]cholarship|[Gg]rant|[Ff]ellowship|[Aa]ward|[Ss]cheme|[Yy]ojana))/,
    /^([A-Z][^.\n]{10,100}(?:[Ss]cholarship|[Gg]rant|[Ff]ellowship|[Aa]ward|[Ss]cheme))/m
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      let name = match[1].trim();
      name = name.replace(/^(The |A )/i, '');
      if (name.length > 10 && name.length < 150) return name;
    }
  }
  
  return 'Educational Opportunity';
}

function extractAmount(text) {
  const patterns = [
    /₹[\d,.\s]+(?:\s*(?:lakh|crore|per year|per month|annually|monthly))?/gi,
    /Rs\.?\s*[\d,.\s]+(?:\s*(?:lakh|crore|per year|per month|annually))?/gi,
    /INR\s*[\d,.\s]+/gi,
    /up to\s*₹?[\d,.\s]+/gi,
    /amount[:\s]*₹?[\d,.\s]+(?:\s*(?:lakh|crore|per year))?/gi
  ];
  
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      return matches[0].trim();
    }
  }
  
  return 'Amount varies';
}

function extractEligibility(text) {
  const patterns = [
    /eligibility[:\s]*([^.\n]{20,150})/i,
    /eligible[:\s]*([^.\n]{20,150})/i,
    /criteria[:\s]*([^.\n]{20,150})/i,
    /requirements?[:\s]*([^.\n]{20,150})/i,
    /for\s+([^.\n]{25,120}(?:students|candidates))/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      let eligibility = match[1].trim();
      if (eligibility.length > 20) return eligibility;
    }
  }
  
  return 'Check official website for detailed eligibility criteria';
}

function extractDeadline(text) {
  const patterns = [
    /deadline[:\s]*([^.\n]{10,60})/i,
    /due[:\s]*(by\s+[^.\n]{8,50})/i,
    /apply by[:\s]*([^.\n]{10,50})/i,
    /last date[:\s]*([^.\n]{10,50})/i,
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*202[5-6]\b/,
    /\d{1,2}[\/\-]\d{1,2}[\/\-]202[5-6]/,
    /202[5-6]\s*(?:deadline|due)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return (match[1] || match[0]).trim();
    }
  }
  
  return 'Check official website for application deadlines';
}

function extractDescription(text) {
  const sentences = text.split(/[.!?]+/);
  const relevantSentences = sentences
    .filter(sentence => 
      sentence.length > 40 && 
      sentence.length < 200 &&
      !sentence.toLowerCase().includes('scholarship name') &&
      !sentence.toLowerCase().includes('eligibility criteria') &&
      !sentence.toLowerCase().includes('application deadline')
    )
    .slice(0, 2);
  
  if (relevantSentences.length > 0) {
    return relevantSentences.join('. ').trim() + '.';
  }
  
  return 'Financial assistance program for eligible students to pursue higher education.';
}

function extractLink(text) {
  const patterns = [
    /(https?:\/\/[^\s)]+)/,
    /(?:website|portal|apply)[:\s]*(www\.[^\s]+)/i,
    /(?:visit|check)[:\s]*(www\.[^\s]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let link = match[1] || match[0];
      if (!link.startsWith('http')) {
        link = 'https://' + link;
      }
      // Validate URL format
      try {
        new URL(link);
        return link;
      } catch {
        continue;
      }
    }
  }
  
  return null;
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    availableEndpoints: ['/', '/health', '/api/search-scholarships'],
    method: req.method,
    path: req.originalUrl
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CareerFlow Scholarship API running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🎓 API endpoint: http://localhost:${PORT}/api/search-scholarships`);
  console.log(`🔑 API Key configured: ${process.env.PERPLEXITY_API_KEY ? 'YES' : 'NO'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});
