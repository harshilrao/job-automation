import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Filter,
  RefreshCw,
  Briefcase,
  MapPin,
  ExternalLink,
  Loader2,
  AlertCircle,
  Clock,
  Play,
  Trash2,
  X,
  Save,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { api } from '../services/api';
import { JobPosting, FilterCriteria } from '@shared/types';
import { formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';

const ONTARIO_CITIES = [
  'Toronto', 'Ottawa', 'Mississauga', 'Brampton', 'Hamilton',
  'London', 'Markham', 'Vaughan', 'Windsor', 'Kitchener',
  'Oakville', 'Richmond Hill', 'Burlington', 'Oshawa', 'Barrie',
  'Guelph', 'St. Catharines', 'Kingston', 'Peterborough', 'Waterloo',
];

const JOB_TYPES = ['full-time', 'part-time', 'contract', 'internship', 'temporary', 'freelance'];
const EXPERIENCE_LEVELS = ['entry', 'junior', 'mid', 'senior', 'lead', 'principal', 'executive'];
const SOURCES = ['indeed', 'linkedin', 'glassdoor', 'ziprecruiter', 'jobbank', 'google', 'company'];

type PersistenceStatus = 'discovered' | 'saving' | 'saved' | 'failed-to-save';

interface DisplayJob {
  key: string;            // stable identity: `${source}-${externalId}`
  dbId?: string;          // Mongo _id once saved; undefined for temp results
  title: string;
  company: string;
  city: string;
  province: string;
  remote: boolean;
  hybrid: boolean;
  jobType: string;
  experienceLevel: string;
  salaryMin?: number;
  salaryMax?: number;
  source: string;
  postedDate: Date;
  applicationUrl: string;
  originalJobUrl?: string;
  description?: string;   // scraped description, may be empty
  status: PersistenceStatus;
  saved: boolean;
}

function jobKey(source: string, externalId: string): string {
  return `${source}-${externalId}`;
}

function normalizeJobPosting(j: JobPosting): DisplayJob {
  return {
    key: jobKey(j.source, j.externalId),
    dbId: j._id,
    title: j.title,
    company: j.company,
    city: j.location.city,
    province: j.location.province,
    remote: j.location.remote,
    hybrid: j.location.hybrid,
    jobType: j.jobType,
    experienceLevel: j.experienceLevel,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
    source: j.source,
    postedDate: new Date(j.postedDate),
    applicationUrl: j.applicationUrl,
    originalJobUrl: j.originalJobUrl,
    description: j.description,
    status: 'saved',
    saved: true,
  };
}

function normalizeJobPost(j: any): DisplayJob {
  const externalId = j.id;
  return {
    key: jobKey(j.source, externalId),
    dbId: undefined,
    title: j.title || 'Untitled Position',
    company: j.company || 'Unknown Company',
    city: (j.location && j.location.split(',')[0]) || '',
    province: 'ON',
    remote: j.workArrangement === 'remote' || j.isRemote || false,
    hybrid: j.workArrangement === 'hybrid' || (j.location && j.location.toLowerCase().includes('hybrid')) || false,
    jobType: j.jobType || 'full-time',
    experienceLevel: j.jobLevel || 'mid',
    salaryMin: j.salary?.min,
    salaryMax: j.salary?.max,
    source: j.source,
    postedDate: j.datePosted ? new Date(j.datePosted) : new Date(),
    applicationUrl: j.originalJobUrl || j.applyUrl || j.jobUrl || '',
    originalJobUrl: j.originalJobUrl,
    description: j.description || '',
    status: 'discovered',
    saved: false,
  };
}

export function Jobs() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobPosting[]>([]);          // saved jobs from MongoDB
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Shared filter state — one panel for Search and Start Scrape
  const [filters, setFilters] = useState<FilterCriteria>({
    searchTerm: '',
    locations: [],
    jobTypes: [],
    experienceLevels: [],
    industries: [],
    departments: [],
    salaryMin: undefined,
    salaryMax: undefined,
    postedWithinHours: 72,
    remoteOnly: false,
    hybridOnly: false,
    sources: [],
    excludedCompanies: [],
    excludedKeywords: [],
    requiredKeywords: [],
  });
  // Debounced copy of the filters used to re-query saved jobs (keeps typing cheap).
  const [debouncedFilters, setDebouncedFilters] = useState<FilterCriteria>(filters);

  const [savedFilters, setSavedFilters] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);

  // Scrape / search session state
  const [scrapeProgress, setScrapeProgress] = useState<any>(null);
  const [scraping, setScraping] = useState(false);
  const [scrapeSessionId, setScrapeSessionId] = useState<string | null>(null);
  const [scrapeError, setScrapeError] = useState('');
  const scrapeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // 'searching' = Search Jobs (external, no save) | 'scraping' = Start Scraping (save to MongoDB)
  const [mode, setMode] = useState<'idle' | 'searching' | 'scraping'>('idle');

  // Temporary discovered jobs from the current scrape session (not yet saved)
  const [discoveredJobs, setDiscoveredJobs] = useState<DisplayJob[]>([]);
  const [viewTab, setViewTab] = useState<'all' | 'saved' | 'discovered'>('all');
  const [savingJobIds, setSavingJobIds] = useState<Set<string>>(new Set());
  // Job the user is previewing (supports unsaved temp jobs without a Mongo _id)
  const [previewJob, setPreviewJob] = useState<DisplayJob | null>(null);

  // Delete-all-jobs state
  const [deletingAllJobs, setDeletingAllJobs] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  const reachabilityNote = 'Temporary result — save to MongoDB to keep it.';

  // Debounce filter changes before re-querying saved jobs (keeps typing cheap)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
    }, 400);
    return () => clearTimeout(timer);
  }, [filters]);

  // Load saved jobs from MongoDB whenever (debounced) filters or page change
  useEffect(() => {
    loadJobs();
  }, [debouncedFilters, pagination.page]);

  useEffect(() => {
    loadSavedFilters();
    loadStats();
  }, []);

  useEffect(() => {
    return () => {
      if (scrapeIntervalRef.current) {
        clearInterval(scrapeIntervalRef.current);
      }
    };
  }, []);

  const loadJobs = async () => {
    setLoading(true);
    setError('');
    setDeleteError('');
    setDeleteSuccess(false);

    try {
      const params: any = {
        page: pagination.page,
        limit: pagination.limit,
        sortBy: 'postedDate',
        sortOrder: 'desc',
      };

      if (debouncedFilters.searchTerm) params.searchTerm = debouncedFilters.searchTerm;
      if (filters.locations.length) params.cities = filters.locations;
      if (filters.jobTypes.length) params.jobTypes = filters.jobTypes;
      if (filters.experienceLevels.length) params.experienceLevels = filters.experienceLevels;
      if (filters.industries.length) params.industries = filters.industries;
      if (filters.departments.length) params.departments = filters.departments;
      if (filters.salaryMin) params.salaryMin = filters.salaryMin;
      if (filters.salaryMax) params.salaryMax = filters.salaryMax;
      if (filters.postedWithinHours) params.postedWithinHours = filters.postedWithinHours;
      if (filters.remoteOnly) params.remoteOnly = true;
      if (filters.hybridOnly) params.hybridOnly = true;
      if (filters.sources.length) params.sources = filters.sources;
      if (filters.excludedCompanies.length) params.excludedCompanies = filters.excludedCompanies;
      if (filters.excludedKeywords.length) params.excludedKeywords = filters.excludedKeywords;
      if (filters.requiredKeywords.length) params.requiredKeywords = filters.requiredKeywords;

      const response = await api.searchJobs(params);
      const saved = response.jobs;
      setJobs(saved);

      // Reconcile temp discovered jobs whose records now exist in MongoDB
      setDiscoveredJobs(prev =>
        prev.map(d => {
          const match = saved.find(
            (s: JobPosting) => jobKey(s.source, s.externalId) === d.key
          );
          if (match) {
            return { ...d, dbId: match._id, status: 'saved', saved: true };
          }
          return d;
        })
      );

      setPagination(prev => ({
        ...prev,
        total: response.pagination.total,
        totalPages: response.pagination.totalPages,
      }));
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  const loadSavedFilters = async () => {
    try {
      const response = await api.getSearchFilters();
      setSavedFilters(response.filters);
    } catch (err) {
      console.error('Failed to load saved filters:', err);
    }
  };

  const loadStats = async () => {
    try {
      const response = await api.getJobStats();
      setStats(response.stats);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  // Merge progressively discovered jobs into the table, deduped by stable key.
  // Saved rows (dbId / saved status) are preserved when the same job is re-seen.
  const mergeFoundJobs = (prev: DisplayJob[], found: any[]): DisplayJob[] => {
    const byKey = new Map(prev.map((d) => [d.key, d]));
    for (const j of found) {
      const d = normalizeJobPost(j);
      const existing = byKey.get(d.key);
      if (existing) {
        byKey.set(d.key, {
          ...existing,
          ...d,
          dbId: existing.dbId,
          saved: existing.saved,
          status: existing.saved ? 'saved' : d.status,
        });
      } else {
        byKey.set(d.key, d);
      }
    }
    return Array.from(byKey.values());
  };

  // Replace the session's discovered results with the backend's final deduplicated
  // unique set. Cross-source duplicates collapse here; saved/dbId status carries over.
  const reconcileUniqueJobs = (prev: DisplayJob[], unique: any[]): DisplayJob[] => {
    const normalized = unique.map((j) => normalizeJobPost(j));
    const wanted = new Set(normalized.map((d) => d.key));
    const byKey = new Map<string, DisplayJob>();
    for (const d of prev) {
      if (wanted.has(d.key)) byKey.set(d.key, d);
    }
    for (const d of normalized) {
      const existing = byKey.get(d.key);
      byKey.set(d.key, {
        ...d,
        dbId: existing?.dbId,
        saved: existing?.saved ?? false,
        status: existing?.saved ? 'saved' : 'discovered',
      });
    }
    return Array.from(byKey.values());
  };

  const startScrapePolling = (sessionId: string) => {
    if (scrapeIntervalRef.current) clearInterval(scrapeIntervalRef.current);
    scrapeIntervalRef.current = setInterval(async () => {
      try {
        const response = await api.getScrapeProgress(sessionId);
        const progress = response.progress;
        setScrapeProgress(progress);

        // Display discovered jobs progressively — do not wait for scraping to finish.
        if (progress.foundJobs && progress.foundJobs.length > 0) {
          setDiscoveredJobs((prev) => mergeFoundJobs(prev, progress.foundJobs));
        }

        // Once deduplication finishes, the unique set is authoritative: drop
        // duplicates and keep only deduplicated jobs (saved status preserved).
        if (progress.uniqueJobs && progress.uniqueJobs.length > 0) {
          setDiscoveredJobs((prev) => reconcileUniqueJobs(prev, progress.uniqueJobs));
        }

        if (
          progress.status === 'completed' ||
          progress.status === 'failed' ||
          progress.status === 'cancelled'
        ) {
          setScraping(false);
          setMode('idle');
          if (scrapeIntervalRef.current) {
            clearInterval(scrapeIntervalRef.current);
            scrapeIntervalRef.current = null;
          }
          loadJobs();
          loadStats();
        }
      } catch (err) {
        console.error('Failed to get scrape progress:', err);
      }
    }, 2000);
  };

  const hasScrapeFilters = () => {
    return (
      !!filters.searchTerm.trim() ||
      filters.locations.length > 0 ||
      filters.jobTypes.length > 0 ||
      filters.experienceLevels.length > 0 ||
      filters.industries.length > 0 ||
      filters.departments.length > 0 ||
      !!filters.salaryMin ||
      !!filters.salaryMax ||
      filters.remoteOnly ||
      filters.hybridOnly ||
      filters.sources.length > 0 ||
      filters.excludedCompanies.length > 0 ||
      filters.excludedKeywords.length > 0 ||
      filters.requiredKeywords.length > 0
    );
  };

  const runSearchOrScrape = async (save: boolean) => {
    if (!hasScrapeFilters()) {
      setError('Please select at least one job filter before scraping.');
      return;
    }

    setScraping(true);
    setMode(save ? 'scraping' : 'searching');
    setScrapeProgress(null);
    setDiscoveredJobs([]);   // clear previous results so the table shows only this session's jobs
    setError('');
    setScrapeError('');
    setPreviewJob(null);

    try {
      const response = await api.triggerScrape(filters, { save });
      const session = response.session;
      if (session?.sessionId) {
        setScrapeSessionId(session.sessionId);
        localStorage.setItem('scrapeSessionId', session.sessionId);
        startScrapePolling(session.sessionId);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || `Failed to start ${save ? 'scraping' : 'search'}`);
      setScraping(false);
      setMode('idle');
      return;
    }
  };

  const handleSearch = () => runSearchOrScrape(false);
  const handleStartScraping = () => runSearchOrScrape(true);

  const handleCancelScrape = async () => {
    if (!scrapeSessionId) return;
    setScrapeError('');
    try {
      await api.cancelScrape(scrapeSessionId);
    } catch (err: any) {
      setScrapeError(err.response?.data?.error || 'Failed to cancel scraping');
      setScraping(false);
      setMode('idle');
    }
  };

  // Recover an in-progress scrape/search session after a refresh
  useEffect(() => {
    const storedSessionId = localStorage.getItem('scrapeSessionId');
    if (!storedSessionId) return;

    const recover = async () => {
      try {
        const response = await api.getScrapeProgress(storedSessionId);
        const progress = response.progress;
        if (progress && (progress.status === 'running' || progress.status === 'cancelling')) {
          setScrapeSessionId(storedSessionId);
          setScrapeProgress(progress);
          setScraping(true);
          startScrapePolling(storedSessionId);
        } else {
          localStorage.removeItem('scrapeSessionId');
          setScrapeSessionId(null);
        }
      } catch {
        localStorage.removeItem('scrapeSessionId');
        setScrapeSessionId(null);
      }
    };

    recover();
  }, []);

  const handleSaveJob = async (job: DisplayJob) => {
    if (savingJobIds.has(job.key)) return;
    setSavingJobIds(prev => new Set([...prev, job.key]));

    try {
      const payload = {
        id: job.key.split('-').slice(1).join('-'),
        title: job.title,
        company: job.company,
        location: `${job.city}, ${job.province}`,
        description: job.description || '',
        jobUrl: job.applicationUrl,
        applyUrl: job.applicationUrl,
        source: job.source,
        datePosted: job.postedDate.toISOString(),
        salary: job.salaryMin || job.salaryMax
          ? { min: job.salaryMin, max: job.salaryMax, currency: 'CAD' }
          : undefined,
        jobType: job.jobType,
        jobLevel: job.experienceLevel,
        isRemote: job.remote,
        workArrangement: (job.remote && 'remote') || (job.hybrid && 'hybrid') || 'unspecified',
        originalJobUrl: job.originalJobUrl,
        companyCareerUrl: job.originalJobUrl,
        applicationUrl: job.applicationUrl,
      };
      await api.saveJob(payload);

      setDiscoveredJobs(prev =>
        prev.map(d =>
          d.key === job.key ? { ...d, status: 'saved', saved: true } : d
        )
      );
      await loadJobs();
    } catch (err: any) {
      setDiscoveredJobs(prev =>
        prev.map(d =>
          d.key === job.key ? { ...d, status: 'failed-to-save' } : d
        )
      );
      console.error('Failed to save job:', err.response?.data?.error || err.message);
    } finally {
      setSavingJobIds(prev => {
        const next = new Set(prev);
        next.delete(job.key);
        return next;
      });
    }
  };

  const handleDeleteAllJobs = async () => {
    setDeletingAllJobs(true);
    setDeleteError('');
    setDeleteSuccess(false);

    try {
      await api.deleteAllJobs();
      setJobs([]);
      setDiscoveredJobs([]);
      setPagination(prev => ({ ...prev, total: 0, totalPages: 0 }));
      await loadStats();
      setDeleteSuccess(true);
      setConfirmDeleteAll(false);
    } catch (err: any) {
      setDeleteError(err.response?.data?.error || 'Failed to delete job postings');
    } finally {
      setDeletingAllJobs(false);
    }
  };

  const handleFilterChange = (key: keyof FilterCriteria, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination((prev: { page: number; limit: number; total: number; totalPages: number }) => ({ ...prev, page: 1 }));
  };

  const toggleFilterArray = (key: keyof FilterCriteria, value: string) => {
    setFilters(prev => {
      const current = prev[key] as string[];
      const newValue = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [key]: newValue };
    });
    setPagination((prev: { page: number; limit: number; total: number; totalPages: number }) => ({ ...prev, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({
      searchTerm: '',
      locations: [],
      jobTypes: [],
      experienceLevels: [],
      industries: [],
      departments: [],
      salaryMin: undefined,
      salaryMax: undefined,
      postedWithinHours: 72,
      remoteOnly: false,
      hybridOnly: false,
      sources: [],
      excludedCompanies: [],
      excludedKeywords: [],
      requiredKeywords: [],
    });
    setDiscoveredJobs([]);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const applySavedFilter = async (filterId: string) => {
    try {
      const response = await api.applySavedFilter(filterId, { page: 1, limit: pagination.limit });
      setJobs(response.jobs);
      setPagination(prev => ({
        ...prev,
        total: response.pagination.total,
        totalPages: response.pagination.totalPages,
        page: 1,
      }));
    } catch (err) {
      console.error('Failed to apply saved filter:', err);
    }
  };

  const handlePageChange = (page: number) => {
    setPagination(prev => ({ ...prev, page }));
  };

  const getSalaryDisplay = (job: DisplayJob) => {
    if (job.salaryMin && job.salaryMax) {
      return `$${job.salaryMin.toLocaleString()} - $${job.salaryMax.toLocaleString()}`;
    } else if (job.salaryMin) {
      return `$${job.salaryMin.toLocaleString()}+`;
    } else if (job.salaryMax) {
      return `Up to $${job.salaryMax.toLocaleString()}`;
    }
    return 'Not specified';
  };

  const getLocationDisplay = (job: DisplayJob) => {
    const parts = [job.city, job.province];
    if (job.remote) parts.push('Remote');
    if (job.hybrid) parts.push('Hybrid');
    return parts.filter(Boolean).join(', ');
  };

  const getSourceColor = (source: string) => {
    const colors: Record<string, string> = {
      linkedin: 'bg-blue-100 text-blue-800',
      indeed: 'bg-orange-100 text-orange-800',
      glassdoor: 'bg-green-100 text-green-800',
      ziprecruiter: 'bg-purple-100 text-purple-800',
      jobbank: 'bg-red-100 text-red-800',
      google: 'bg-gray-100 text-gray-800',
      company: 'bg-indigo-100 text-indigo-800',
    };
    return colors[source] || 'bg-gray-100 text-gray-800';
  };

  const statusBadge = (status: PersistenceStatus) => {
    switch (status) {
      case 'discovered': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'saving': return 'bg-amber-100 text-amber-800 border-amber-200 animate-pulse';
      case 'saved': return 'bg-green-100 text-green-800 border-green-200';
      case 'failed-to-save': return 'bg-red-100 text-red-800 border-red-200';
    }
  };

  const statusLabel = (status: PersistenceStatus) => {
    switch (status) {
      case 'discovered': return 'Discovered';
      case 'saving': return 'Saving…';
      case 'saved': return 'Saved';
      case 'failed-to-save': return 'Failed to Save';
    }
  };

  // Merge saved + discovered jobs into ONE table, deduped by stable key.
  // Saved jobs come from MongoDB; discovered jobs are temp scrape results.
  const tableData = useMemo(() => {
    const byKey = new Map<string, DisplayJob>();
    jobs.forEach(j => byKey.set(jobKey(j.source, j.externalId), normalizeJobPosting(j)));

    discoveredJobs.forEach(d => {
      if (byKey.has(d.key)) return; // already represented by the saved record
      byKey.set(d.key, d);
    });
    return Array.from(byKey.values());
  }, [jobs, discoveredJobs]);

  const filteredTable = tableData.filter(d => {
    if (viewTab === 'saved') return d.saved;
    if (viewTab === 'discovered') return !d.saved;
    return true;
  });

  const totalCount = filteredTable.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pagination.limit));
  const safePage = Math.min(Math.max(pagination.page, 1), totalPages);
  const pageStart = (safePage - 1) * pagination.limit;
  const pageResults = filteredTable.slice(pageStart, pageStart + pagination.limit);

  // Normalize page back into range if it went out of bounds
  useEffect(() => {
    if (pagination.page !== safePage) {
      setPagination(prev => ({ ...prev, page: safePage }));
    }
  }, [pagination.page, safePage]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Search Dashboard</h1>
          <p className="text-gray-600 mt-1">
            {stats?.total?.toLocaleString() ?? 0} saved jobs
            {scraping
              ? ` · ${mode === 'searching' ? 'Searching' : 'Scraping'} in progress`
              : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-nowrap">
          {scraping && scrapeSessionId ? (
            <>
              <button
                onClick={handleSearch}
                disabled={scraping || loading || !hasScrapeFilters()}
                className={clsx('btn-outline btn-sm', !hasScrapeFilters() && 'opacity-50 cursor-not-allowed')}
                title="Search"
              >
                <Search className="w-4 h-4" />
                Search
              </button>
              <button
                onClick={loadJobs}
                disabled={loading || scraping}
                className="btn-secondary btn-sm"
              >
                <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
                Refresh
              </button>
              <button
                onClick={handleCancelScrape}
                disabled={loading}
                className="btn-danger btn-sm"
              >
                <AlertCircle className="w-4 h-4" />
                Cancel Scraping
              </button>
              <button
                onClick={() => setConfirmDeleteAll(true)}
                disabled={deletingAllJobs || scraping || loading}
                className="btn-danger btn-sm"
              >
                {deletingAllJobs ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                {deletingAllJobs ? 'Deleting…' : 'Delete All Jobs'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleSearch}
                disabled={scraping || loading || !hasScrapeFilters()}
                className={clsx('btn-outline btn-sm', !hasScrapeFilters() && 'opacity-50 cursor-not-allowed')}
                title="Search"
              >
                <Search className="w-4 h-4" />
                Search
              </button>
              <button
                onClick={loadJobs}
                disabled={loading || scraping}
                className="btn-secondary btn-sm"
              >
                <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
                Refresh
              </button>
              <button
                onClick={handleStartScraping}
                disabled={scraping || loading || !hasScrapeFilters()}
                className={clsx('btn-primary btn-sm', !hasScrapeFilters() && 'opacity-50 cursor-not-allowed')}
                title="Start Scrape"
              >
                <Play className="w-4 h-4" />
                Start Scrape
              </button>
              <button
                onClick={() => setConfirmDeleteAll(true)}
                disabled={deletingAllJobs || scraping || loading}
                className="btn-danger btn-sm"
              >
                {deletingAllJobs ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                {deletingAllJobs ? 'Deleting…' : 'Delete All Jobs'}
              </button>
            </>
          )}

          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={clsx('btn-secondary btn-sm', filtersOpen && 'bg-primary-50 text-primary-700 border-primary-200')}
          >
            <Filter className="w-4 h-4" />
            {filtersOpen ? 'Hide' : 'Show'} Filters
          </button>
        </div>
      </div>

      {/* Selected filters */}
      {hasScrapeFilters() && (
        <div className="card p-3 mb-4 border border-primary-100 bg-primary-50">
          <p className="text-xs font-semibold text-primary-700 uppercase tracking-wider mb-2">
            Selected filters
          </p>
          <div className="flex flex-wrap gap-2">
            {filters.searchTerm && (
              <span className="px-2 py-1 rounded text-xs border border-primary-200 bg-white text-primary-800">
                {filters.searchTerm}
              </span>
            )}
            {filters.locations.map((loc) => (
              <span key={`loc-${loc}`} className="filter-chip">
                {loc}
              </span>
            ))}
            {filters.jobTypes.map((t) => (
              <span key={`jt-${t}`} className="filter-chip">
                {t.replace('-', ' ')}
              </span>
            ))}
            {filters.experienceLevels.map((l) => (
              <span key={`el-${l}`} className="filter-chip">
                {l.charAt(0).toUpperCase() + l.slice(1)}
              </span>
            ))}
            {filters.industries.map((i) => (
              <span key={`ind-${i}`} className="filter-chip">
                {i}
              </span>
            ))}
            {filters.departments.map((d) => (
              <span key={`dep-${d}`} className="filter-chip">
                {d}
              </span>
            ))}
            {filters.sources.map((s) => (
              <span key={`src-${s}`} className="filter-chip">
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </span>
            ))}
            {filters.remoteOnly && <span className="filter-chip">Remote only</span>}
            {filters.hybridOnly && <span className="filter-chip">Hybrid only</span>}
            {filters.salaryMin && (
              <span className="filter-chip">Min ${filters.salaryMin.toLocaleString()}</span>
            )}
            {filters.salaryMax && (
              <span className="filter-chip">Max ${filters.salaryMax.toLocaleString()}</span>
            )}
            {filters.postedWithinHours && (
              <span className="filter-chip">Posted within {filters.postedWithinHours}h</span>
            )}
            {filters.excludedCompanies.map((c) => (
              <span key={`ec-${c}`} className="filter-chip">
                Not: {c}
              </span>
            ))}
            {filters.excludedKeywords.map((k) => (
              <span key={`ek-${k}`} className="filter-chip">
                Excl: {k}
              </span>
            ))}
            {filters.requiredKeywords.map((k) => (
              <span key={`rk-${k}`} className="filter-chip">
                Req: {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {deleteSuccess && (
        <div className="card p-3 border border-green-200 bg-green-50 mb-4">
          <p className="text-sm text-green-800 font-medium">
            All job postings deleted successfully.
          </p>
        </div>
      )}

      {error && (
        <div className="card p-3 border border-red-200 bg-red-50 mb-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
            <p className="text-sm text-red-800 font-medium">{error}</p>
          </div>
          <button
            onClick={() => setError('')}
            className="ml-2 text-xs text-red-600 hover:text-red-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {scrapeError && (
        <div className="card p-3 border border-red-200 bg-red-50 mb-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
            <p className="text-sm text-red-800 font-medium">{scrapeError}</p>
          </div>
          <button
            onClick={() => setScrapeError('')}
            className="ml-2 text-xs text-red-600 hover:text-red-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {confirmDeleteAll && (
        <div className="card p-4 border border-red-200 bg-red-50 mb-4">
          <h3 className="font-semibold text-red-900 mb-1">Delete All Job Postings?</h3>
          <p className="text-sm text-red-800 mb-4">
            This will permanently delete all saved job postings from your account. Application history,
            user profiles, uploaded resumes and generated documents are NOT deleted. This action cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmDeleteAll(false)}
              className="btn-secondary btn-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteAllJobs}
              disabled={deletingAllJobs}
              className={clsx('btn-danger btn-sm', deletingAllJobs && 'opacity-50 cursor-not-allowed')}
            >
              {deletingAllJobs ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Yes, Delete All'
              )}
            </button>
          </div>
          {deleteError && (
            <p className="mt-3 text-xs text-red-600">{deleteError}</p>
          )}
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4">
            <p className="text-2xl font-bold text-gray-900">{stats.total.toLocaleString()}</p>
            <p className="text-sm text-gray-600">Total Jobs</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-gray-900">{stats.recentCount.toLocaleString()}</p>
            <p className="text-sm text-gray-600">Last 24h</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-gray-900">{Object.keys(stats.bySource).length}</p>
            <p className="text-sm text-gray-600">Sources</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-gray-900">{Object.keys(stats.byCity).length}</p>
            <p className="text-sm text-gray-600">Cities</p>
          </div>
        </div>
      )}

      {/* Search / Scrape progress (realtime progress section) */}
      {(scrapeProgress || scraping) && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary-600" />
                {mode === 'searching' ? 'Searching Jobs' : 'Scraping and Saving Jobs'}
              </h3>
              <p className="text-sm text-gray-600">
                {scrapeProgress?.currentSource ? (
                  <>
                    {mode === 'searching'
                      ? `Searching from <strong>{scrapeProgress.currentSource}</strong>`
                      : `Scraping from <strong>{scrapeProgress.currentSource}</strong>`}
                  </>
                ) : (
                  mode === 'searching' ? 'Starting search...' : 'Starting scrape...'
                )}
              </p>
              {scrapeProgress?.message && (
                <p className="text-xs text-gray-500 mt-1">{scrapeProgress.message}</p>
              )}
            </div>
            <div className="flex gap-2">
              {scraping && (
                <button
                  onClick={loadJobs}
                  disabled={scraping}
                  className="btn-outline btn-sm"
                >
                  Refresh results
                </button>
              )}
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-1 text-sm">
              <span className="text-gray-700 font-medium">
                Overall progress
                {' '}
                ({scrapeProgress?.sourceIndex ?? 0} of {scrapeProgress?.totalSources ?? 0} sources)
              </span>
              <span className="text-gray-700 font-mono">
                {scrapeProgress?.jobsFound ?? 0} jobs found
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-primary-600 h-3 rounded-full transition-all duration-500"
                style={{
                  width: scrapeProgress?.totalSources
                    ? Math.min(100, ((scrapeProgress.sourceIndex ?? 0) / scrapeProgress.totalSources) * 100)
                    : 0,
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                scrapeProgress?.status === 'running'
                  ? 'bg-green-100 text-green-800'
                  : scrapeProgress?.status === 'cancelling'
                  ? 'bg-amber-100 text-amber-800'
                  : scrapeProgress?.status === 'cancelled'
                  ? 'bg-red-100 text-red-800'
                  : scrapeProgress?.status === 'completed'
                  ? 'bg-blue-100 text-blue-800'
                  : scrapeProgress?.status === 'failed'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {scrapeProgress?.status || 'idle'}
            </span>
            {scrapeProgress?.status === 'cancelling' && (
              <span className="font-medium text-amber-800">Cancelling {mode === 'searching' ? 'search' : 'scraping'}…</span>
            )}
            {scrapeProgress?.status === 'cancelled' && (
              <span className="font-medium text-red-800">
                {mode === 'searching' ? 'Search cancelled.' : 'Scraping cancelled. Previously saved jobs have been preserved.'}
              </span>
            )}
            {scrapeProgress?.status === 'completed' && (
              <span className="font-medium text-green-800">
                {mode === 'searching' ? 'Search completed.' : 'Scraping completed.'}
              </span>
            )}
            {scrapeProgress?.status === 'failed' && (
              <span className="font-medium text-red-800">
                {scrapeProgress?.message || (mode === 'searching' ? 'Search failed.' : 'Scraping failed.')}
              </span>
            )}
          </div>

          <div className="text-sm text-gray-700 mb-3">
            {mode === 'searching' ? 'Searching' : 'Scraping'}{' '}
            {scrapeProgress?.currentSource && (
              <>
                <strong>
                  {scrapeProgress.currentSource.charAt(0).toUpperCase() +
                    scrapeProgress.currentSource.slice(1)}
                </strong>{' | '}
              </>
            )}
            {scrapeProgress?.jobsFound ?? 0} jobs found{' | '}
            {scrapeProgress?.uniqueJobs?.length ?? 0} unique after dedup{' | '}
            {scrapeProgress?.jobsSaved ?? 0} matching jobs saved
            {scrapeProgress?.jobsSkipped != null && ` | ${scrapeProgress.jobsSkipped} skipped`}
            {scrapeProgress?.jobsFailed != null && ` | ${scrapeProgress.jobsFailed} failed`}
          </div>

          {scrapeProgress?.sources && scrapeProgress.sources.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-900">Sources (selected platforms)</span>
                <span className="text-xs text-gray-500">per-source results</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {scrapeProgress.sources.map((src: string) => {
                  const sp = scrapeProgress.sourceProgress.find((s: any) => s.source === src);
                  const status = sp?.status || 'pending';
                  return (
                    <span
                      key={src}
                      className={clsx(
                        'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                        status === 'running'
                          ? 'bg-blue-100 text-blue-800 border-blue-200 animate-pulse'
                          : status === 'completed'
                          ? 'bg-green-100 text-green-800 border-green-200'
                          : status === 'failed'
                          ? 'bg-red-100 text-red-800 border-red-200'
                          : 'bg-gray-100 text-gray-600 border-gray-200'
                      )}
                    >
                      {src.charAt(0).toUpperCase() + src.slice(1)}:{sp?.jobsFound ?? 0}
                      {sp?.error ? <span className="ml-1 text-[10px]">⚠</span> : null}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {scrapeProgress?.errors && Object.keys(scrapeProgress.errors).length > 0 && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg">
              <div className="flex items-start gap-2 mb-1">
                <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
                <span className="text-sm text-red-800 font-medium">Errors</span>
              </div>
              <ul className="text-xs text-red-700 space-y-1 list-disc list-inside">
                {Object.entries(scrapeProgress.errors).map(([source, msg]) => (
                  <li key={source}>{source}: {String(msg)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Filters Sidebar */}
      {filtersOpen && (
        <div className="card">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
          </div>
          <div className="p-4 space-y-6">
            <div>
              <label className="label">Job Title / Position</label>
              <input
                type="text"
                value={filters.searchTerm}
                onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
                placeholder="e.g. Salesforce Developer"
                className="input w-full"
              />
            </div>

            <div>
              <label className="label">Keywords / Skills</label>
              <input
                type="text"
                value={filters.requiredKeywords.join(', ')}
                onChange={(e) =>
                  handleFilterChange(
                    'requiredKeywords',
                    e.target.value.split(',').map((k) => k.trim()).filter(Boolean)
                  )
                }
                placeholder="e.g. TypeScript, Salesforce, Apex"
                className="input w-full"
              />
            </div>

            <div>
              <label className="label">Locations</label>
              <div className="flex flex-wrap gap-2">
                {ONTARIO_CITIES.map(city => (
                  <button
                    key={city}
                    type="button"
                    onClick={() => toggleFilterArray('locations', city)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                      filters.locations.includes(city)
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    {city}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Employment Type</label>
              <div className="flex flex-wrap gap-2">
                {JOB_TYPES.map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggleFilterArray('jobTypes', type)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                      filters.jobTypes.includes(type)
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    {type.replace('-', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Experience Level</label>
              <div className="flex flex-wrap gap-2">
                {EXPERIENCE_LEVELS.map(level => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => toggleFilterArray('experienceLevels', level)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                      filters.experienceLevels.includes(level)
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Work Arrangement</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleFilterChange('remoteOnly', !filters.remoteOnly)}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                    filters.remoteOnly
                      ? 'bg-primary-100 text-primary-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  )}
                >
                  Remote only
                </button>
                <button
                  type="button"
                  onClick={() => handleFilterChange('hybridOnly', !filters.hybridOnly)}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                    filters.hybridOnly
                      ? 'bg-primary-100 text-primary-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  )}
                >
                  Hybrid only
                </button>
              </div>
            </div>

            <div>
              <label className="label">Platform Selection</label>
              <div className="flex flex-wrap gap-2">
                {SOURCES.map(source => (
                  <button
                    key={source}
                    type="button"
                    onClick={() => toggleFilterArray('sources', source)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                      filters.sources.includes(source)
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    {source.charAt(0).toUpperCase() + source.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Min Salary</label>
                <input
                  type="number"
                  value={filters.salaryMin || ''}
                  onChange={(e) => handleFilterChange('salaryMin', e.target.value ? parseInt(e.target.value) : undefined)}
                  placeholder="e.g. 80000"
                  className="input"
                />
              </div>
              <div>
                <label className="label">Max Salary</label>
                <input
                  type="number"
                  value={filters.salaryMax || ''}
                  onChange={(e) => handleFilterChange('salaryMax', e.target.value ? parseInt(e.target.value) : undefined)}
                  placeholder="e.g. 150000"
                  className="input"
                />
              </div>
            </div>

            <div>
              <label className="label">Posted Within</label>
              <select
                value={filters.postedWithinHours || ''}
                onChange={(e) => handleFilterChange('postedWithinHours', e.target.value ? parseInt(e.target.value) : undefined)}
                className="input"
              >
                <option value="">Any time</option>
                <option value={24}>Last 24 hours</option>
                <option value={72}>Last 3 days</option>
                <option value={168}>Last week</option>
                <option value={720}>Last month</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Saved Filters */}
      {savedFilters.length > 0 && (
        <div className="card p-4">
          <h3 className="font-medium text-gray-900 mb-3">Saved Filters</h3>
          <div className="flex flex-wrap gap-2">
            {savedFilters.map((filter: any) => (
              <button
                key={filter._id}
                type="button"
                onClick={() => applySavedFilter(filter._id)}
                className={clsx(
                  'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                  filter.isDefault
                    ? 'bg-primary-100 text-primary-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                {filter.name} {filter.isDefault && <span className="ml-1 text-xs">(default)</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Single Jobs table with view selector */}
      <div className="card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-gray-900">Jobs</h2>
            <span className="text-xs font-medium text-gray-500">({filteredTable.length})</span>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setViewTab('all')}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                viewTab === 'all'
                  ? 'border-primary-600 text-primary-600 bg-primary-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              All ({tableData.length})
            </button>
            <button
              onClick={() => setViewTab('saved')}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                viewTab === 'saved'
                  ? 'border-primary-600 text-primary-600 bg-primary-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              Saved ({jobs.length})
            </button>
            <button
              onClick={() => setViewTab('discovered')}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                viewTab === 'discovered'
                  ? 'border-primary-600 text-primary-600 bg-primary-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              Newly Discovered ({discoveredJobs.length})
            </button>
          </div>
        </div>

        {(!loading || jobs.length > 0 || discoveredJobs.length > 0) && filteredTable.length === 0 && !error ? (
          <div className="p-12 text-center">
            <Briefcase className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No jobs found</h3>
            <p className="text-gray-600 mb-4">
              {viewTab === 'discovered'
                ? 'No newly discovered jobs yet. Run a Search or Start Scrape to surface external postings.'
                : 'Try adjusting your search or filters'}
            </p>
            <button onClick={clearFilters} className="btn-secondary">Clear all filters</button>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-80">Position</th>
                    <th className="w-48">Company</th>
                    <th className="w-40">Location</th>
                    <th className="w-32">Type</th>
                    <th className="w-32">Experience</th>
                    <th className="w-36">Salary</th>
                    <th className="w-28">Platform</th>
                    <th className="w-32">Posted</th>
                    <th className="w-24">Save Status</th>
                    <th className="w-36">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageResults.map((job) => (
                    <tr key={job.key} className="hover:bg-gray-50">
                      <td className="font-medium text-gray-900 truncate max-w-xs" title={job.title}>
                        {job.title}
                      </td>
                      <td className="text-gray-700 truncate max-w-xs" title={job.company}>
                        {job.company}
                      </td>
                      <td className="text-gray-600">
                        <div className="flex items-center gap-1 text-sm">
                          <MapPin className="w-3.5 h-3.5 text-gray-400" />
                          <span className="truncate max-w-xs">{getLocationDisplay(job)}</span>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-gray">{job.jobType.replace('-', ' ')}</span>
                      </td>
                      <td>
                        <span className="badge badge-gray">{job.experienceLevel.charAt(0).toUpperCase() + job.experienceLevel.slice(1)}</span>
                      </td>
                      <td className="text-gray-600 text-sm">{getSalaryDisplay(job)}</td>
                      <td>
                        <span className={clsx('badge', getSourceColor(job.source))}>
                          {job.source.charAt(0).toUpperCase() + job.source.slice(1)}
                        </span>
                      </td>
                      <td className="text-gray-500 text-sm">
                        {formatDistanceToNow(new Date(job.postedDate), { addSuffix: true })}
                      </td>
                      <td>
                        <span className={clsx('badge px-2 py-1 text-xs', statusBadge(job.status))}>
                          {statusLabel(job.status)}
                          {!job.saved && <span className="ml-1 text-[10px] opacity-70">{reachabilityNote}</span>}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          {!job.saved && (
                            <button
                              onClick={() => handleSaveJob(job)}
                              disabled={savingJobIds.has(job.key)}
                              className="btn-outline btn-sm"
                              title="Save Job"
                            >
                              {savingJobIds.has(job.key) ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Save className="w-3 h-3" />
                              )}
                              <span className="hidden sm:inline ml-1">Save Job</span>
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (job.dbId) {
                                navigate(`/jobs/${job.dbId}`);
                              } else {
                                setPreviewJob(job);
                              }
                            }}
                            className={clsx('btn-primary btn-sm', !job.dbId && 'cursor-default')}
                            title={job.dbId ? 'View job details' : 'Preview temporary result'}
                          >
                            <span className="hidden sm:inline">View</span>
                          </button>
                          <a
                            href={job.applicationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={clsx('btn-outline btn-sm', !job.applicationUrl && 'opacity-50 cursor-not-allowed')}
                            title={job.applicationUrl ? 'Apply / Open original posting' : 'No apply URL'}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageResults.length === 0 && totalCount > 0 && (
                    <tr>
                      <td colSpan={10} className="text-center text-gray-500 py-4">
                        No results on this page.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="p-4 border-t border-gray-200 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Showing {pageResults.length > 0 ? pageStart + 1 : 0} to {Math.min(pageStart + pageResults.length, totalCount)} of {totalCount} jobs
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePageChange(safePage - 1)}
                    disabled={safePage === 1}
                    className="btn-outline btn-sm"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (safePage <= 3) {
                      pageNum = i + 1;
                    } else if (safePage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = safePage - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={clsx(
                          'w-8 h-8 rounded-lg text-sm font-medium transition-colors',
                          safePage === pageNum
                            ? 'bg-primary-600 text-white'
                            : 'text-gray-600 hover:bg-gray-100'
                        )}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => handlePageChange(safePage + 1)}
                    disabled={safePage === totalPages}
                    className="btn-outline btn-sm"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Inline job detail preview for unsaved (temp) results — no Mongo _id needed */}
      {previewJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPreviewJob(null)} />
          <div className="relative w-full max-w-2xl p-4">
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">{previewJob.title}</h2>
                <button
                  onClick={() => setPreviewJob(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mb-2">
                <span className={clsx('badge', getSourceColor(previewJob.source))}>
                  {previewJob.source}
                </span>{' '}
                <span className={clsx('badge px-2 py-1 text-xs', statusBadge(previewJob.status))}>
                  {statusLabel(previewJob.status)}
                </span>
              </div>
              <p className="text-gray-700 mb-2">
                <strong>Company:</strong> {previewJob.company}
              </p>
              <p className="text-gray-700 mb-2">
                <strong>Location:</strong> {getLocationDisplay(previewJob)}
              </p>
              <p className="text-gray-700 mb-2">
                <strong>Type:</strong>{' '}
                {previewJob.jobType.replace('-', ' ')} ·{' '}
                {previewJob.experienceLevel.charAt(0).toUpperCase() + previewJob.experienceLevel.slice(1)}
              </p>
              <p className="text-gray-700 mb-2">
                <strong>Salary:</strong> {getSalaryDisplay(previewJob)}
              </p>
              <p className="text-gray-700 mb-2">
                <strong>Posted:</strong> {formatDistanceToNow(new Date(previewJob.postedDate), { addSuffix: true })}
              </p>
              {!previewJob.saved && (
                <p className="text-xs text-blue-600 mb-4">
                  Temporary result — scraped but not yet saved to MongoDB.{' '}
                  {previewJob.originalJobUrl
                    ? 'Original posting: '
                    : ''}
                </p>
              )}
              <div className="flex items-center gap-3">
                {previewJob.applicationUrl && (
                  <a
                    href={previewJob.originalJobUrl || previewJob.applicationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary whitespace-nowrap"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Apply / Open Original Posting
                  </a>
                )}
                {!previewJob.saved && (
                  <button
                    onClick={() => {
                      handleSaveJob(previewJob);
                      setPreviewJob(null);
                    }}
                    disabled={savingJobIds.has(previewJob.key)}
                    className="btn-outline"
                  >
                    {savingJobIds.has(previewJob.key) ? 'Saving…' : 'Save Job'}
                  </button>
                )}
                <button
                  onClick={() => setPreviewJob(null)}
                  className="btn-ghost"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
