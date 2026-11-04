import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, RefreshCw, Briefcase, MapPin, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
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

  const loadJobs = async () => {
    setLoading(true);
    setError('');

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