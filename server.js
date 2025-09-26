const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting - 100 requests per 15 minutes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(limiter);

// CORS - Allow all origins for now, you can restrict later
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'CareerFlow Scholarship API is running!',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'CareerFlow Scholarship API',
    timestamp: new Date().toISOString()
  });
});

// Main scholarship search endpoint
app.post('/api/search-scholarships', async (req, res) => {
  console.log('📝 Scholarship search request received:', req.body);
  
  try {
    const { collegeName, course, location, gpa, category, budget } = req.body;

    // Validate required fields
    if (!collegeName || !course) {
      return res.status(400).json({
        success: false,
        error: 'College name and course are required'
      });
    }

    // Check API key
    if (!process.env.PERPLEXITY_API_KEY) {
      console.error('❌ PERPLEXITY_API_KEY not found');
      return res.status(500).json({
        success: false,
        error: 'Server configuration error'
      });
    }

    // Build search query
    const query = `Find current scholarships for ${course} students at ${collegeName} in India. 
    ${location ? `Focus on ${location} state scholarships.` : ''}
    ${category ? `Include ${category} scholarships.` : ''}
    ${gpa ? `Student academic performance: ${gpa}.` : ''}
    ${budget ? `Budget requirement: ${budget}.` : ''}
    
    Provide specific details:
    - Scholarship name
    - Amount/value in INR
    - Eligibility criteria
    - Application deadline
    - Official website/application link
    
    Focus on scholarships with 2025-2026 deadlines including government, private, and institutional scholarships.`;

    console.log('🔍 Searching with Perplexity API...');

    // Call Perplexity API
    const perplexityResponse = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model: 'sonar-small-online',
        messages: [
          {
            role: 'system',
            content: 'You are an expert scholarship advisor for Indian students. Provide accurate, current scholarship information with specific details.'
          },
          {
            role: 'user',
            content: query
          }
        ],
        max_tokens: 2000,
        temperature: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    if (!perplexityResponse.data?.choices?.[0]?.message?.content) {
      throw new Error('Invalid API response');
    }

    console.log('✅ Got response from Perplexity API');

    // Parse scholarships from response
    const scholarships = parseScholarships(perplexityResponse.data.choices[0].message.content);
    
    console.log(`📊 Found ${scholarships.length} scholarships`);

    res.json({
      success: true,
      scholarships: scholarships,
      total: scholarships.length,
      searchQuery: { collegeName, course, location }
    });

  } catch (error) {
    console.error('❌ Error in scholarship search:', error.message);
    
    if (error.code === 'ECONNABORTED') {
      return res.status(408).json({
        success: false,
        error: 'Search timeout. Please try again.'
      });
    }
    
    if (error.response?.status === 401) {
      return res.status(500).json({
        success: false,
        error: 'API authentication failed'
      });
    }
    
    if (error.response?.status === 429) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please wait and try again.'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to search scholarships. Please try again.'
    });
  }
});

// Parse scholarships from AI response
function parseScholarships(text) {
  const scholarships = [];
  
  try {
    // Split text into potential scholarship sections
    const sections = text.split(/(?:\d+\.|\n-|\*\*|\n#{1,3})/);
    
    for (const section of sections) {
      if (section.length < 50) continue;
      
      const scholarship = {
        name: extractName(section),
        amount: extractAmount(section),
        eligibility: extractEligibility(section),
        deadline: extractDeadline(section),
        description: extractDescription(section),
        link: extractLink(section)
      };
      
      // Only add if we have a meaningful name
      if (scholarship.name && 
          scholarship.name.length > 10 && 
          (scholarship.name.toLowerCase().includes('scholarship') || 
           scholarship.name.toLowerCase().includes('grant') ||
           scholarship.name.toLowerCase().includes('award'))) {
        scholarships.push(scholarship);
      }
    }
    
    // Add fallback scholarships if none found
    if (scholarships.length === 0) {
      scholarships.push(
        {
          name: 'National Scholarship Portal',
          amount: '₹12,000 - ₹2,00,000 per year',
          eligibility: 'Various categories - merit and need based',
          deadline: 'October to December 2025',
          description: 'Government scholarship platform with multiple schemes for different student categories.',
          link: 'https://scholarships.gov.in'
        },
        {
          name: 'Post Matric Scholarship for SC/ST',
          amount: '₹230 - ₹1,200 per month',
          eligibility: 'SC/ST students in higher education',
          deadline: 'November 2025',
          description: 'Central government scholarship for SC/ST students pursuing post-matric courses.',
          link: 'https://scholarships.gov.in'
        },
        {
          name: 'Merit cum Means Scholarship',
          amount: '₹20,000 per year',
          eligibility: 'Family income below ₹2.5 lakh, 80%+ marks',
          deadline: 'December 2025',
          description: 'For meritorious students from economically weaker sections.',
          link: 'https://scholarships.gov.in'
        }
      );
    }
    
  } catch (error) {
    console.error('Error parsing scholarships:', error);
  }
  
  return scholarships.slice(0, 8);
}

function extractName(text) {
  const patterns = [
    /([A-Z][A-Za-z\s&-]+(?:Scholarship|Grant|Fellowship|Award|Scheme|Yojana))/,
    /^([A-Z][^.\n]+(?:Scholarship|Grant|Fellowship|Award))/m
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return 'Educational Grant';
}

function extractAmount(text) {
  const patterns = [
    /₹[\d,.\s]+(?:\s*(?:lakh|crore|per year|annually))?/i,
    /Rs\.?\s*[\d,.\s]+/i,
    /up to\s*₹?[\d,.\s]+/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return 'Amount varies';
}

function extractEligibility(text) {
  const patterns = [
    /eligibility[:\s]*([^.\n]{20,100})/i,
    /eligible[:\s]*([^.\n]{20,100})/i,
    /for\s+([^.\n]{20,100}students)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return 'Check official website';
}

function extractDeadline(text) {
  const patterns = [
    /deadline[:\s]*([^.\n]{10,50})/i,
    /apply by[:\s]*([^.\n]{10,50})/i,
    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1] || match[0];
  }
  return 'Check website';
}

function extractDescription(text) {
  const sentences = text.split(/[.!?]/);
  const good = sentences.filter(s => s.length > 30 && s.length < 150).slice(0, 1);
  return good.length > 0 ? good[0].trim() + '.' : 'Scholarship opportunity available.';
}

function extractLink(text) {
  const match = text.match(/(https?:\/\/[^\s)]+)/);
  return match ? match[1] : 'https://scholarships.gov.in';
}

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    availableEndpoints: ['/health', '/api/search-scholarships']
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 CareerFlow Scholarship API running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🎓 API endpoint: http://localhost:${PORT}/api/search-scholarships`);
  console.log(`🔑 API Key configured: ${process.env.PERPLEXITY_API_KEY ? 'YES' : 'NO'}`);
});
