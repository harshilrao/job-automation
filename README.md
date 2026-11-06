# Job Automation System

A fully automated job search and application system for the Ontario job market. Built with Node.js, React, MongoDB, and AI-powered resume generation.

## 🚀 Features

### Job Search & Discovery
- **Multi-platform scraping**: LinkedIn, Indeed, Glassdoor, ZipRecruiter, Job Bank (Government of Canada)
- **Ontario-focused**: Targets all major Ontario cities (Toronto, Ottawa, Mississauga, etc.)
- **Advanced filtering**: By location, job type, experience level, industry, department, salary, remote/hybrid
- **Saved search filters**: Create and manage custom filter presets
- **Real-time search**: Debounced search with pagination

### AI-Powered Resume & Cover Letter Generation
- **Multiple AI providers**: Free Claude Code, OpenRouter, Groq, NVIDIA Nemotron, Gemini
- **ATS optimization**: Automatic keyword extraction and ATS scoring
- **Multiple tones**: Professional, Enthusiastic, Concise, Storytelling
- **Version control**: Track multiple resume/cover letter versions per job
- **Interview prep**: Generate technical questions, behavioral questions, and company research

### Automated Application System
- **Browser automation**: Playwright-based form filling
- **Platform detection**: Greenhouse, Lever, Workday, iCIMS, SmartRecruiters, BambooHR, Taleo, and more
- **Human-in-the-loop**: CAPTCHA handling and manual intervention points
- **Credential management**: Encrypted storage for portal credentials
- **Screenshot capture**: Visual verification of submissions
- **Queue management**: Priority-based application queue with scheduling

### Profile & Preferences Management
- **Complete profile**: Personal info, experience, education, projects, skills
- **Job preferences**: Desired roles, locations, salary range, job types, industries
- **Import/Export**: JSON-based profile backup and restore
- **Professional summary**: AI-enhanced summary generation

### Dashboard & Analytics
- **Application tracking**: Status pipeline (pending → submitted → interview → offer)
- **Success metrics**: Interview rate, offer rate, success rate
- **Job market overview**: Top sources, cities, recent postings
- **Queue monitoring**: Real-time application queue status

## 🛠 Tech Stack

### Backend
- **Runtime**: Node.js 20+ with TypeScript
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT with refresh tokens
- **Job Scraping**: jobspy-node (TypeScript port of JobSpy)
- **Browser Automation**: Playwright with persistent context
- **AI Integration**: Free Claude Code + OpenRouter + Groq
- **Scheduling**: node-cron
- **Queue**: BullMQ with Redis
- **Validation**: Zod
- **Logging**: Winston

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **State Management**: Zustand + React Hook Form
- **Routing**: React Router v6
- **HTTP Client**: Axios with interceptors
- **Icons**: Lucide React
- **Date Handling**: date-fns

### Infrastructure
- **Containerization**: Docker + Docker Compose
- **Database**: MongoDB Atlas (production) / Local MongoDB (development)
- **Cache/Queue**: Redis
- **Reverse Proxy**: Nginx (production)

## 📋 Prerequisites

- Node.js 20+
- MongoDB 7.0+
- Redis 7+
- Free Claude Code (for AI features)
- Playwright browsers (Chromium)

### Free Claude Code Installation
```bash
# Windows PowerShell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/install.ps1")))

# Start server
fcc-server
```

## 🚀 Quick Start

### 1. Clone and Setup
```bash
git clone <repository-url>
cd job-automation

# Copy environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env  # if exists
```

### 2. Configure Environment Variables
Edit `backend/.env` with your credentials:
```env
# MongoDB (use your Atlas connection string)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net
MONGODB_DB_NAME=job_automation

# JWT Secrets (generate strong random strings)
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_REFRESH_SECRET=your-refresh-secret-change-in-production

# Free Claude Code
FREE_CLAUDE_URL=http://localhost:8080
FREE_CLAUDE_MODEL=open_router/openrouter/free

# Optional: Additional AI providers
OPENROUTER_API_KEY=your-openrouter-key
GROQ_API_KEY=your-groq-key

# Encryption (32 characters)
ENCRYPTION_KEY=your-32-character-encryption-key-here

# Playwright
PLAYWRIGHT_BROWSER=chromium
PLAYWRIGHT_HEADLESS=false
PLAYWRIGHT_USER_DATA_DIR=./browser-profile
```

### 3. Install Dependencies
```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install

# Install Playwright browsers
npx playwright install chromium
```

### 4. Start Development Servers
```bash
# Terminal 1: Start Free Claude Code server
fcc-server

# Terminal 2: Start backend
cd backend
npm run dev

# Terminal 3: Start frontend
cd frontend
npm run dev
```

### 5. Access the Application
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- API Health: http://localhost:3000/health

## 🐳 Docker Deployment

### Development
```bash
docker-compose up -d
```

### Production
```bash
# Build images
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## 📁 Project Structure

```
job-automation/
├── backend/
│   ├── src/
│   │   ├── config/         # Environment, database, free-claude config
│   │   ├── controllers/    # Request handlers
│   │   ├── middleware/     # Auth, validation, error handling
│   │   ├── models/         # Mongoose models
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic
│   │   │   ├── JobScraperService.ts
│   │   │   ├── AIResumeGenerator.ts
│   │   │   ├── BrowserAutomationService.ts
│   │   │   └── ApplicationOrchestrator.ts
│   │   ├── utils/          # Helpers, logger, constants
│   │   ├── jobs/           # Scheduled jobs
│   │   ├── app.ts          # Express app setup
│   │   └── server.ts       # Entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Page components
│   │   ├── hooks/          # Custom React hooks
│   │   ├── services/       # API client
│   │   ├── types/          # TypeScript types
│   │   ├── App.tsx         # Main app with routing
│   │   └── main.tsx        # Entry point
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── Dockerfile
├── shared/
│   └── types/              # Shared TypeScript types
├── docker-compose.yml
└── README.md
```

## 🔧 Configuration

### Job Search Configuration
Edit `backend/src/config/env.ts` or environment variables:
```env
ONTARIO_CITIES=Toronto,Ottawa,Mississauga,Brampton,Hamilton,London,Markham,Vaughan,Windsor,Kitchener
JOB_SOURCES=indeed,linkedin,glassdoor,ziprecruiter
JOB_SEARCH_TERMS=software engineer,developer,programmer,full stack,backend,frontend,devops,data scientist,ml engineer,ai engineer
SCRAPER_CRON=0 */2 * * *  # Every 2 hours
APPLICATION_CRON=0 9 * * 1-5  # Weekdays 9 AM
```

### AI Model Configuration
The system supports multiple AI providers with automatic fallback:
1. **Free Claude Code** (primary) - Local server with multiple free models
2. **OpenRouter** - Free tier models via API
3. **Groq** - Llama 3.3 70B via API
4. **NVIDIA Nemotron** - Via free-claude-code
5. **Gemini** - Via free-claude-code

### Browser Automation
- **Headless mode**: Set `PLAYWRIGHT_HEADLESS=true` for production
- **User data directory**: Persistent browser profile for cookies/sessions
- **Platform selectors**: Pre-configured for major ATS platforms

## 🔐 Security Considerations

- **Encrypted credentials**: AES-256 encryption for stored passwords
- **JWT authentication**: Short-lived access tokens + refresh tokens
- **Rate limiting**: API rate limiting with configurable windows
- **Input validation**: Zod schema validation on all endpoints
- **Helmet.js**: Security headers
- **CORS**: Configured for frontend domain only
- **No sensitive data in logs**: Automatic redaction

## 📊 API Endpoints

### Jobs
- `GET /api/jobs/search` - Search jobs with filters
- `GET /api/jobs/:id` - Get job details
- `GET /api/jobs/stats` - Job market statistics
- `POST /api/jobs/scrape` - Trigger manual scrape
- `GET /api/jobs/cities|companies|skills|sources|job-types|experience-levels|industries|departments` - Filter options

### Search Filters
- `POST /api/jobs/filters` - Save search filter
- `GET /api/jobs/filters` - List saved filters
- `GET /api/jobs/filters/default` - Get default filter
- `PUT /api/jobs/filters/:id` - Update filter
- `DELETE /api/jobs/filters/:id` - Delete filter
- `POST /api/jobs/filters/:id/default` - Set as default
- `POST /api/jobs/filters/:id/apply` - Apply filter to search

### Applications
- `POST /api/applications/apply` - Apply to job
- `GET /api/applications` - List applications
- `GET /api/applications/stats` - Application statistics
- `GET /api/applications/intervention` - Apps needing human intervention
- `GET /api/applications/queue` - Queue status
- `POST /api/applications/:id/retry` - Retry failed application
- `PUT /api/applications/:id/status` - Update status
- `POST /api/applications/:id/withdraw` - Withdraw application
- `POST /api/applications/search-and-queue` - Search and queue jobs

### AI Generation
- `POST /api/applications/resume/generate` - Generate resume
- `GET /api/applications/resumes` - List generated resumes
- `POST /api/applications/cover-letter/generate` - Generate cover letter
- `GET /api/applications/cover-letters` - List cover letters
- `POST /api/applications/ats/analyze` - ATS analysis
- `GET /api/applications/models` - Available AI models

### Profile
- `GET /api/profile` - Get profile
- `PUT /api/profile` - Update profile
- `PUT /api/profile/personal-info` - Update personal info
- `PUT /api/profile/skills` - Update skills
- `POST/PUT/DELETE /api/profile/experience` - Manage experience
- `POST/PUT/DELETE /api/profile/education` - Manage education
- `POST/PUT/DELETE /api/profile/projects` - Manage projects
- `PUT /api/profile/preferences` - Update preferences
- `PUT /api/profile/summary` - Update professional summary
- `GET/POST /api/profile/export|import` - Import/export profile

### AI Utilities
- `GET /api/ai/free-claude/status` - Free Claude status
- `GET /api/ai/models` - Available models
- `POST /api/ai/free-claude/test` - Test prompt
- `POST /api/ai/extract-keywords` - Extract keywords
- `POST /api/ai/improve-resume` - Improve resume
- `POST /api/ai/interview-prep` - Generate interview prep
- `POST /api/ai/analyze-fit` - Analyze job fit
- `POST /api/ai/rewrite-bullets` - Rewrite bullet points
- `POST /api/ai/thank-you-note` - Generate thank you note
- `POST /api/ai/negotiate-salary` - Salary negotiation script

## 🎯 Usage Examples

### 1. Complete Job Search Flow
```typescript
// Search for jobs
const jobs = await api.searchJobs({
  searchTerm: 'software engineer',
  cities: ['Toronto', 'Mississauga'],
  jobTypes: ['full-time'],
  experienceLevels: ['mid', 'senior'],
  remoteOnly: false,
  page: 1,
  limit: 20
});

// View job details
const job = await api.getJobById(jobId);

// Generate tailored resume
const resume = await api.generateResume({
  jobPostingId: jobId,
  tone: 'professional',
  focusKeywords: ['React', 'Node.js', 'AWS']
});

// Generate cover letter
const coverLetter = await api.generateCoverLetter({
  jobPostingId: jobId,
  resumeId: resume.resume._id,
  tone: 'professional'
});

// Apply
await api.applyToJob({
  jobPostingId: jobId,
  resumeId: resume.resume._id,
  coverLetterId: coverLetter.coverLetter._id
});
```

### 2. Automated Job Search & Apply
```typescript
// Search and queue up to 5 jobs
await api.searchAndQueueJobs({
  searchTerm: 'full stack developer',
  cities: ['Toronto', 'Ottawa'],
  maxApplications: 5
});

// Process queue (runs automatically via cron)
await api.getQueueStatus();
```

### 3. AI-Powered Career Tools
```typescript
// Analyze job fit
const analysis = await api.analyzeJobFit({
  jobDescription: job.description,
  userProfile: profile
});

// Generate interview prep
const prep = await api.generateInterviewPrep({
  jobDescription: job.description,
  resume: resumeContent,
  userProfile: profile
});

// Rewrite bullet points
const improved = await api.rewriteBulletPoints({
  bullets: ['Built React app', 'Used Node.js'],
  jobDescription: job.description,
  tone: 'professional'
});
```

## 🔄 Scheduled Jobs

The system runs automated tasks via cron:

| Job | Schedule | Description |
|-----|----------|-------------|
| Job Scraping | Every 2 hours (`0 */2 * * *`) | Scrapes all configured sources for new Ontario jobs |
| Application Processing | Weekdays 9 AM (`0 9 * * 1-5`) | Processes queued applications |
| Daily Stats | Midnight (`0 0 * * *`) | Logs daily job statistics |

## 🐛 Troubleshooting

### Common Issues

**Free Claude Code not connecting**
```bash
# Check server is running
curl http://localhost:8080/health

# Check model availability
curl http://localhost:8080/v1/models
```

**Playwright browser issues**
```bash
# Reinstall browsers
npx playwright install chromium

# Check dependencies
npx playwright install-deps
```

**MongoDB connection failed**
- Verify connection string in `.env`
- Check network access (IP whitelist for Atlas)
- Ensure database user has read/write permissions

**Rate limiting from job sites**
- Increase `SCRAPER_DEFAULTS.RATE_LIMIT_DELAY` in constants
- Reduce `RESULTS_WANTED` per search
- Use residential proxies for production scraping

## 📈 Performance Optimization

- **Database indexes**: Compound indexes on common query patterns
- **Pagination**: Limit results to 20-50 per page
- **Caching**: Redis caching for filter options and stats
- **Lazy loading**: Frontend code splitting with React.lazy
- **Image optimization**: WebP format, lazy loading
- **Bundle analysis**: `npm run build -- --analyze`

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [jobspy-node](https://github.com/DaKheera47/jobspy-node) - Job scraping library
- [free-claude-code](https://github.com/alishahryar1/free-claude-code) - Free AI access
- [Playwright](https://playwright.dev/) - Browser automation
- [Tailwind CSS](https://tailwindcss.com/) - Styling framework
- [MongoDB](https://www.mongodb.com/) - Database

## 📞 Support

For issues and feature requests, please open a GitHub issue.

---

**Built with ❤️ for Ontario job seekers**
