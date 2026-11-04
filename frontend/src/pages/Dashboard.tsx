import { useState, useEffect } from 'react';
import { FileText, TrendingUp, Target, Clock, Loader2, Briefcase as BriefcaseIcon, MapPin, DollarSign, CheckCircle, AlertCircle, PenTool, Activity, BarChart3 } from 'lucide-react';
import { api } from '../services/api';
import { JobPosting, ApplicationRecord, ApplicationStats } from '@shared/types';
import { formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';

export function Dashboard() {
  const [stats, setStats] = useState<ApplicationStats | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobPosting[]>([]);
  const [recentApplications, setRecentApplications] = useState<ApplicationRecord[]>([]);
  const [jobStats, setJobStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const [statsRes, recentJobsRes, recentAppsRes, jobStatsRes] = await Promise.all([
        api.getApplicationStats(),
        api.searchJobs({ page: 1, limit: 5, sortBy: 'postedDate', sortOrder: 'desc' }),
        api.getApplications({ page: 1, limit: 5 }),
        api.getJobStats(),
      ]);
      setStats(statsRes.stats);
      setRecentJobs(recentJobsRes.jobs);
      setRecentApplications(recentAppsRes.applications);
      setJobStats(jobStatsRes.stats);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusConfig = (status: string) => {
    const configs: Record<string, { color: string; icon: any }> = {
      pending: { color: 'text-gray-600', icon: Clock },
      'in-progress': { color: 'text-blue-600', icon: Loader2 },
      submitted: { color: 'text-green-600', icon: CheckCircle },
      failed: { color: 'text-red-600', icon: AlertCircle },
      rejected: { color: 'text-red-600', icon: AlertCircle },
      interview: { color: 'text-purple-600', icon: BriefcaseIcon },
      offer: { color: 'text-emerald-600', icon: CheckCircle },
      withdrawn: { color: 'text-gray-600', icon: AlertCircle },
    };
    return configs[status] || { color: 'text-gray-600', icon: Clock };
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="card p-6 animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-3/4 mb-4" />
            <div className="h-12 bg-gray-200 rounded w-1/4" />
          </div>
        ))}
      </div>
    );
  }

  const totalApplications = stats?.total || 0;
  const activeApplications = (stats?.submitted || 0) + (stats?.['in-progress'] || 0) + (stats?.pending || 0);
  const successRate = totalApplications > 0 ? Math.round(((stats?.interview || 0) + (stats?.offer || 0)) / totalApplications * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">Overview of your job search progress</p>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Applications</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{totalApplications}</p>
            </div>
            <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
              <FileText className="w-6 h-6 text-primary-600" />
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Active Applications</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">{activeApplications}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <Activity className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Interviews</p>
              <p className="text-3xl font-bold text-purple-600 mt-1">{stats?.interview || 0}</p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <BriefcaseIcon className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Success Rate</p>
              <p className="text-3xl font-bold text-emerald-600 mt-1">{successRate}%</p>
            </div>
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-emerald-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <button className="btn-outline p-6 hover:bg-primary-50 hover:border-primary-200 transition-colors text-left">
            <PenTool className="w-8 h-8 text-primary-600 mb-3" />
            <h3 className="font-medium text-gray-900">Generate Resume</h3>
            <p className="text-sm text-gray-600 mt-1">Create AI-tailored resume</p>
          </button>
          <button className="btn-outline p-6 hover:bg-primary-50 hover:border-primary-200 transition-colors text-left">
            <BriefcaseIcon className="w-8 h-8 text-primary-600 mb-3" />
            <h3 className="font-medium text-gray-900">Search Jobs</h3>
            <p className="text-sm text-gray-600 mt-1">Find new opportunities</p>
          </button>
          <button className="btn-outline p-6 hover:bg-primary-50 hover:border-primary-200 transition-colors text-left">
            <Target className="w-8 h-8 text-primary-600 mb-3" />
            <h3 className="font-medium text-gray-900">Auto Apply</h3>
            <p className="text-sm text-gray-600 mt-1">Queue applications</p>
          </button>
          <button className="btn-outline p-6 hover:bg-primary-50 hover:border-primary-200 transition-colors text-left">
            <BarChart3 className="w-8 h-8 text-primary-600 mb-3" />
            <h3 className="font-medium text-gray-900">View Analytics</h3>
            <p className="text-sm text-gray-600 mt-1">Track your progress</p>
          </button>
        </div>
      </div>

      {/* Recent Jobs & Applications */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Job Matches */}
        <div className="card">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Latest Job Matches</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {recentJobs.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <BriefcaseIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No recent jobs found</p>
              </div>
            ) : (
              recentJobs.map((job) => (
                <div key={job._id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 truncate">{job.title}</h3>
                      <p className="text-sm text-gray-600">{job.company}</p>
                      <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" />
                          {job.location.city}, {job.location.province}
                        </span>
                        <span className="flex items-center gap-1">
                          <DollarSign className="w-3.5 h-3.5" />
                          {job.salaryMin && job.salaryMax ? `$${job.salaryMin.toLocaleString()} - $${job.salaryMax.toLocaleString()}` : 'Not specified'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={clsx('badge', job.source === 'linkedin' ? 'bg-blue-100 text-blue-800' : job.source === 'indeed' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800')}>
                        {job.source}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Applications */}
        <div className="card">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Recent Applications</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {recentApplications.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No recent applications</p>
              </div>
            ) : (
              recentApplications.map((app) => {
                const job = app.jobPostingId as any;
                const config = getStatusConfig(app.status);
                const Icon = config.icon;
                return (
                  <div key={app._id} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-gray-900 truncate">{job?.title}</h3>
                          <span className={clsx('badge flex items-center gap-1', config.color)}>
                            <Icon className="w-3.5 h-3.5" />
                            {app.status}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">{job?.company}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          Applied {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Job Market Stats */}
      {jobStats && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Job Market Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{jobStats.total.toLocaleString()}</p>
              <p className="text-sm text-gray-600">Total Active Jobs</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{jobStats.recentCount.toLocaleString()}</p>
              <p className="text-sm text-gray-600">Posted Last 24h</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{Object.keys(jobStats.bySource).length}</p>
              <p className="text-sm text-gray-600">Sources</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900">{Object.keys(jobStats.byCity).length}</p>
              <p className="text-sm text-gray-600">Cities</p>
            </div>
          </div>

          {/* Top Sources */}
          <div className="mt-6">
            <h3 className="text-md font-medium text-gray-900 mb-3">Top Sources</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(jobStats.bySource)
                .sort((a, b) => (b[1] as number) - (a[1] as number))
                .slice(0, 5)
                .map(([source, count]) => (
                  <span key={source} className="badge badge-primary">
                    {source}: {String(count)}
                  </span>
                ))}
            </div>
          </div>

          {/* Top Cities */}
          <div className="mt-6">
            <h3 className="text-md font-medium text-gray-900 mb-3">Top Cities</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(jobStats.byCity)
                .sort((a, b) => (b[1] as number) - (a[1] as number))
                .slice(0, 5)
                .map(([city, count]) => (
                  <span key={city} className="badge badge-gray">
                    {city}: {String(count)}
                  </span>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}