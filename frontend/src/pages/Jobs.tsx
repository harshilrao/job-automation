import { useState, useEffect, useRef } from 'react';
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

export function Jobs() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Search state
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  // Filter state
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

  const [savedFilters, setSavedFilters] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [scrapeProgress, setScrapeProgress] = useState<any>(null);
  const [scraping, setScraping] = useState(false);
  const [scrapeSessionId, setScrapeSessionId] = useState<string | null>(null);
  const [scrapeError, setScrapeError] = useState('');
  const scrapeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Delete-all-jobs state
  const [deletingAllJobs, setDeletingAllJobs] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Load jobs when filters change
  useEffect(() => {
    loadJobs();
  }, [debouncedSearchTerm, filters, pagination.page]);

  // Load saved filters and stats
  useEffect(() => {
    loadSavedFilters();
    loadStats();
  }, []);

  // Cleanup scrape polling interval on unmount
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

      if (debouncedSearchTerm) params.searchTerm = debouncedSearchTerm;
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
      setJobs(response.jobs);
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

  const startScrapePolling = (sessionId: string) => {
    if (scrapeIntervalRef.current) clearInterval(scrapeIntervalRef.current);
    scrapeIntervalRef.current = setInterval(async () => {
      try {
        const response = await api.getScrapeProgress(sessionId);
        const progress = response.progress;
        setScrapeProgress(progress);

        if (
          progress.status === 'completed' ||
          progress.status === 'failed' ||
          progress.status === 'cancelled'
        ) {
          setScraping(false);
          if (scrapeIntervalRef.current) {
            clearInterval(scrapeIntervalRef.current);
            scrapeIntervalRef.current = null;
          }
          // Refresh jobs once scraping completes so new results show
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

  const handleTriggerScrape = async () => {
    if (!hasScrapeFilters()) {
      setError('Please select at least one job filter before scraping.');
      return;
    }

    setScraping(true);
    setScrapeProgress(null);
    setError('');
    setScrapeError('');

    try {
      const response = await api.triggerScrape(filters);
      const session = response.session;
      if (session?.sessionId) {
        setScrapeSessionId(session.sessionId);
        localStorage.setItem('scrapeSessionId', session.sessionId);
        startScrapePolling(session.sessionId);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start scraping');
      setScraping(false);
      return;
    }
  };

  const handleCancelScrape = async () => {
    if (!scrapeSessionId) return;
    setScrapeError('');
    try {
      await api.cancelScrape(scrapeSessionId);
      // Polling detects 'cancelled' and stops; scraping flag stays until then
    } catch (err: any) {
      setScrapeError(err.response?.data?.error || 'Failed to cancel scraping');
      setScraping(false);
    }
  };

  // Recover an in-progress scrape session after a refresh
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

  const handleDeleteAllJobs = async () => {
    setDeletingAllJobs(true);
    setDeleteError('');
    setDeleteSuccess(false);

    try {
      await api.deleteAllJobs();
      setJobs([]);
      setPagination(prev => ({ ...prev, total: 0, totalPages: 0 }));
      await loadStats();
      setDeleteSuccess(true);
      setConfirmDeleteAll(false);
    } catch (err: any) {
      setDeleteError(err.response?.data?.error || 'Failed to delete job postings');
      // Dialog stays open so the user can see the error and retry or cancel.
    } finally {
      setDeletingAllJobs(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPagination(prev => ({ ...prev, page: 1 }));
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
    setSearchTerm('');
    setDebouncedSearchTerm('');
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const hasActiveFilters = () => {
    return (
      filters.locations.length > 0 ||
      filters.jobTypes.length > 0 ||
      filters.experienceLevels.length > 0 ||
      filters.industries.length > 0 ||
      filters.departments.length > 0 ||
      filters.salaryMin ||
      filters.salaryMax ||
      filters.remoteOnly ||
      filters.hybridOnly ||
      filters.sources.length > 0
    );
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

  const getSalaryDisplay = (job: JobPosting) => {
    if (job.salaryMin && job.salaryMax) {
      return `$${job.salaryMin.toLocaleString()} - $${job.salaryMax.toLocaleString()}`;
    } else if (job.salaryMin) {
      return `$${job.salaryMin.toLocaleString()}+`;
    } else if (job.salaryMax) {
      return `Up to $${job.salaryMax.toLocaleString()}`;
    }
    return 'Not specified';
  };

  const getLocationDisplay = (job: JobPosting) => {
    const parts = [job.location.city, job.location.province];
    if (job.location.remote) parts.push('Remote');
    if (job.location.hybrid) parts.push('Hybrid');
    return parts.join(', ');
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Search</h1>
          <p className="text-gray-600 mt-1">
            {pagination.total} jobs found{pagination.totalPages > 1 ? ` (Page ${pagination.page} of ${pagination.totalPages})` : ''}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadJobs}
            disabled={loading}
            className="btn-secondary btn-sm"
          >
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
            Refresh
          </button>

          {scraping && scrapeSessionId ? (
            <button
              onClick={handleCancelScrape}
              disabled={loading}
              className="btn-danger btn-sm"
            >
              <AlertCircle className="w-4 h-4" />
              Cancel Scraping
            </button>
          ) : (
            <button
              onClick={handleTriggerScrape}
              disabled={scraping || loading}
              className={clsx('btn-primary btn-sm', scraping && 'opacity-50 cursor-not-allowed')}
            >
              {scraping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {scraping ? 'Scraping…' : 'Start Scrape'}
            </button>
          )}

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

          <button
            onClick={() => setMobileFiltersOpen(true)}
            className="lg:hidden btn-secondary btn-sm"
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>

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
            This will permanently delete all saved job postings from your account. This action cannot be undone.
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

      {/* Scrape Progress / Realtime Results */}
      {(scrapeProgress || scraping) && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary-600" />
                Live Scraping
              </h3>
              <p className="text-sm text-gray-600">
                {scrapeProgress?.currentSource ? (
  <>
    Scraping from <strong>{scrapeProgress.currentSource}</strong>
  </>
) : (
  'Starting scrape...'
)}
              </p>
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

          {/* Overall progress bar */}
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

          {/* Status line */}
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
              <span className="font-medium text-amber-800">Cancelling scraping…</span>
            )}
            {scrapeProgress?.status === 'cancelled' && (
              <span className="font-medium text-red-800">
                Scraping cancelled. Previously saved jobs have been preserved.
              </span>
            )}
            {scrapeProgress?.status === 'completed' && (
              <span className="font-medium text-green-800">Scraping completed.</span>
            )}
            {scrapeProgress?.status === 'failed' && (
              <span className="font-medium text-red-800">
                {scrapeProgress?.message || 'Scraping failed.'}
              </span>
            )}
          </div>

          {/* Live counts */}
          {scrapeProgress?.currentSource && (
            <div className="text-sm text-gray-700 mb-3">
              Scraping{' '}
              <strong>
                {scrapeProgress.currentSource.charAt(0).toUpperCase() +
                  scrapeProgress.currentSource.slice(1)}
              </strong>{' | '}
              {scrapeProgress.jobsFound ?? 0} jobs found{' | '}
              {scrapeProgress.jobsSaved ?? 0} matching jobs saved
              {scrapeProgress.jobsSkipped != null && ` | ${scrapeProgress.jobsSkipped} skipped`}
            </div>
          )}

          {/* Per-source references & status */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-900">Sources (references)</span>
              <span className="text-xs text-gray-500">per-source results</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {scrapeProgress?.sources.map((src: string) => {
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

          {/* Errors */}
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

          {/* Realtime found jobs */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-gray-900">Jobs found (real time)</h4>
              <span className="text-xs text-gray-500">{scrapeProgress?.foundJobs?.length ?? 0} so far</span>
            </div>
            {scrapeProgress?.foundJobs?.length === 0 && scraping ? (
              <div className="p-4 text-center text-gray-500 text-sm">Waiting for first results…</div>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-2">
                {scrapeProgress?.foundJobs?.slice().reverse().map((job: any) => (
                  <div
                    key={job._id || job.title + job.company + job.source}
                    className="flex items-center gap-3 p-2 bg-gray-50 rounded border border-gray-100"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-gray-900 truncate">{job.title}</span>
                        <span className={clsx('text-xs font-medium px-1.5 py-0.5 rounded', getSourceColor(job.source))}>
                          {job.source.charAt(0).toUpperCase() + job.source.slice(1)}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 truncate">
                        {job.company} · {job.location?.city || ''}{job.location?.city && job.location?.province ? ', ' : ''}{job.location?.province || ''}
                      </div>
                    </div>
                    <a
                      href={job.applicationUrl || job.originalJobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary-600 hover:underline whitespace-nowrap shrink-0"
                    >
                      View
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="card p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search jobs, companies, skills..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <button type="submit" className="btn-primary whitespace-nowrap">
            Search
          </button>
          {hasActiveFilters() && (
            <button
              type="button"
              onClick={clearFilters}
              className="btn-ghost text-red-600 hover:text-red-700 whitespace-nowrap"
            >
              Clear filters
            </button>
          )}
        </div>
      </form>

      {/* Filters Sidebar */}
      {filtersOpen && (
        <div className="card">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
          </div>
          <div className="p-4 space-y-6">
            {/* Locations */}
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

            {/* Job Types */}
            <div>
              <label className="label">Job Types</label>
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

            {/* Experience Levels */}
            <div>
              <label className="label">Experience Levels</label>
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

            {/* Remote/Hybrid */}
            <div>
              <label className="label">Work Type</label>
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

            {/* Sources */}
            <div>
              <label className="label">Sources</label>
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

            {/* Salary Range */}
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

            {/* Posted Within */}
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

      {/* Mobile Filters Modal */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileFiltersOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-sm bg-white shadow-xl overflow-y-auto">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Filters</h2>
              <button onClick={() => setMobileFiltersOpen(false)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>
            <div className="p-4 space-y-6">
              {/* Simplified mobile filters */}
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
              {/* Add other mobile filters similarly */}
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

      {/* Jobs Table */}
      <div className="card">
        {loading && jobs.length === 0 ? (
          <div className="p-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading jobs...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p className="text-gray-600 mb-4">{error}</p>
            <button onClick={loadJobs} className="btn-primary">Retry</button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-12 text-center">
            <Briefcase className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No jobs found</h3>
            <p className="text-gray-600 mb-4">Try adjusting your search or filters</p>
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
                    <th className="w-28">Source</th>
                    <th className="w-32">Posted</th>
                    <th className="w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job._id} className="hover:bg-gray-50">
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
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => navigate(`/jobs/${job._id}`)}
                            className="btn-primary btn-sm"
                          >
                            View
                          </button>
                          <a
                            href={job.applicationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-outline btn-sm"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="p-4 border-t border-gray-200 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Showing {(pagination.page - 1) * pagination.limit + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} jobs
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page === 1}
                    className="btn-outline btn-sm"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (pagination.totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (pagination.page <= 3) {
                      pageNum = i + 1;
                    } else if (pagination.page >= pagination.totalPages - 2) {
                      pageNum = pagination.totalPages - 4 + i;
                    } else {
                      pageNum = pagination.page - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={clsx(
                          'w-8 h-8 rounded-lg text-sm font-medium transition-colors',
                          pagination.page === pageNum
                            ? 'bg-primary-600 text-white'
                            : 'text-gray-600 hover:bg-gray-100'
                        )}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page === pagination.totalPages}
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
    </div>
  );
}

import { ChevronLeft, ChevronRight } from 'lucide-react';