import { useState, useEffect } from 'react';
import { Briefcase, FileText, Clock, AlertCircle, CheckCircle, XCircle, Loader2, MoreVertical, RefreshCw, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../services/api';
import { ApplicationRecord, ApplicationStats } from '@shared/types';
import { formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';

export function Applications() {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [stats, setStats] = useState<ApplicationStats | null>(null);
  const [queueStatus, setQueueStatus] = useState<any>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadApplications();
    loadStats();
    loadQueueStatus();
  }, [pagination.page, statusFilter]);

  const loadApplications = async () => {
    setLoading(true);
    try {
      const response = await api.getApplications({ status: statusFilter, page: pagination.page, limit: pagination.limit });
      setApplications(response.applications);
      setPagination(prev => ({
        ...prev,
        total: response.pagination.total,
        totalPages: response.pagination.totalPages,
      }));
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await api.getApplicationStats();
      setStats(response.stats);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const loadQueueStatus = async () => {
    try {
      const response = await api.getQueueStatus();
      setQueueStatus(response.queue);
    } catch (err) {
      console.error('Failed to load queue:', err);
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await api.retryApplication(id);
      loadApplications();
      loadQueueStatus();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to retry');
    }
  };

  const handleWithdraw = async (id: string) => {
    if (!confirm('Are you sure you want to withdraw this application?')) return;
    try {
      await api.withdrawApplication(id);
      loadApplications();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to withdraw');
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await api.updateApplicationStatus(id, { status });
      loadApplications();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update status');
    }
  };

  const getStatusConfig = (status: string) => {
    const configs: Record<string, { label: string; color: string; icon: any }> = {
      pending: { label: 'Pending', color: 'bg-gray-100 text-gray-800', icon: Clock },
      'in-progress': { label: 'In Progress', color: 'bg-blue-100 text-blue-800', icon: Loader2 },
      submitted: { label: 'Submitted', color: 'bg-green-100 text-green-800', icon: CheckCircle },
      failed: { label: 'Failed', color: 'bg-red-100 text-red-800', icon: AlertCircle },
      rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800', icon: XCircle },
      interview: { label: 'Interview', color: 'bg-purple-100 text-purple-800', icon: Briefcase },
      offer: { label: 'Offer', color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle },
      withdrawn: { label: 'Withdrawn', color: 'bg-gray-100 text-gray-800', icon: XCircle },
    };
    return configs[status] || { label: status, color: 'bg-gray-100 text-gray-800', icon: Clock };
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const config = getStatusConfig(status);
    const Icon = config.icon;
    return (
      <span className={clsx('badge flex items-center gap-1', config.color)}>
        <Icon className="w-3.5 h-3.5" />
        {config.label}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Applications</h1>
          <p className="text-gray-600 mt-1">Track and manage your job applications</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={loadApplications} disabled={loading} className="btn-secondary btn-sm">
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          <div className="card p-4">
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            <p className="text-sm text-gray-600">Total</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-blue-600">{stats.submitted + stats['in-progress'] + stats.pending}</p>
            <p className="text-sm text-gray-600">Active</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-purple-600">{stats.interview}</p>
            <p className="text-sm text-gray-600">Interviews</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-emerald-600">{stats.offer}</p>
            <p className="text-sm text-gray-600">Offers</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-gray-600">{stats.rejected}</p>
            <p className="text-sm text-gray-600">Rejected</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
            <p className="text-sm text-gray-600">Failed</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-gray-600">{stats.withdrawn}</p>
            <p className="text-sm text-gray-600">Withdrawn</p>
          </div>
        </div>
      )}

      {/* Queue Status */}
      {queueStatus && queueStatus.queue.length > 0 && (
        <div className="card p-4 bg-blue-50 border-blue-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              <div>
                <p className="font-medium text-blue-900">Applications in Queue</p>
                <p className="text-sm text-blue-700">{queueStatus.queue.length} pending, {queueStatus.stats.processing} processing</p>
              </div>
            </div>
            <button onClick={loadQueueStatus} className="btn-secondary btn-sm">Refresh Queue</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search applications..."
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
            className="input w-auto"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in-progress">In Progress</option>
            <option value="submitted">Submitted</option>
            <option value="failed">Failed</option>
            <option value="rejected">Rejected</option>
            <option value="interview">Interview</option>
            <option value="offer">Offer</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </div>
      </div>

      {/* Applications Table */}
      <div className="card">
        {loading && applications.length === 0 ? (
          <div className="p-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading applications...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p className="text-gray-600 mb-4">{error}</p>
            <button onClick={loadApplications} className="btn-primary">Retry</button>
          </div>
        ) : applications.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No applications yet</h3>
            <p className="text-gray-600 mb-4">Start applying to jobs to see them here</p>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-64">Position</th>
                    <th className="w-40">Company</th>
                    <th className="w-32">Status</th>
                    <th className="w-32">Method</th>
                    <th className="w-32">ATS</th>
                    <th className="w-32">Applied</th>
                    <th className="w-40">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((app) => {
                    const job = app.jobPostingId as any;
                    // const config = getStatusConfig(app.status); // Used in StatusBadge
                    return (
                      <tr key={app._id} className={clsx('hover:bg-gray-50', expandedId === app._id && 'bg-blue-50')}>
                        <td className="font-medium text-gray-900">
                          <p className="truncate max-w-xs" title={job?.title}>{job?.title}</p>
                          <p className="text-sm text-gray-500 truncate max-w-xs">{job?.company}</p>
                        </td>
                        <td className="text-gray-700">{job?.company}</td>
                        <td>
                          <StatusBadge status={app.status} />
                        </td>
                        <td>
                          <span className="badge badge-gray">{app.applicationMethod}</span>
                        </td>
                        <td>
                          {app.atsPlatform && (
                            <span className="badge badge-gray text-xs">{app.atsPlatform}</span>
                          )}
                        </td>
                        <td className="text-gray-500 text-sm">
                          {app.appliedAt ? formatDistanceToNow(new Date(app.appliedAt), { addSuffix: true }) : '—'}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setExpandedId(expandedId === app._id ? null : app._id)}
                              className="btn-ghost btn-sm p-1"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Expanded Row Details */}
            {expandedId && (
              <tr className="bg-blue-50">
                <td colSpan={7} className="p-0">
                  <div className="p-4 border-t border-gray-200 bg-white">
                    {(() => {
                      const app = applications.find(a => a._id === expandedId);
                      if (!app) return null;
                      // const job = app.jobPostingId as any; // Not used in expanded view
                      return (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <h4 className="font-medium text-gray-900 mb-2">Details</h4>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <dt className="text-gray-600">Application ID</dt>
                                <dd className="font-mono text-gray-900">{app._id.slice(-8)}</dd>
                              </div>
                              <div className="flex justify-between">
                                <dt className="text-gray-600">URL</dt>
                                <dd className="text-gray-900 truncate max-w-xs">{app.applicationUrl}</dd>
                              </div>
                              <div className="flex justify-between">
                                <dt className="text-gray-600">Method</dt>
                                <dd className="text-gray-900 capitalize">{app.applicationMethod.replace('-', ' ')}</dd>
                              </div>
                              {app.atsPlatform && (
                                <div className="flex justify-between">
                                  <dt className="text-gray-600">ATS Platform</dt>
                                  <dd className="text-gray-900">{app.atsPlatform}</dd>
                                </div>
                              )}
                              {app.submissionData?.confirmationNumber && (
                                <div className="flex justify-between">
                                  <dt className="text-gray-600">Confirmation</dt>
                                  <dd className="font-mono text-gray-900">{app.submissionData.confirmationNumber}</dd>
                                </div>
                              )}
                            </dl>
                          </div>
                          <div>
                            <h4 className="font-medium text-gray-900 mb-2">Error Log</h4>
                            {app.errorLog.length > 0 ? (
                              <ul className="space-y-2 text-sm">
                                {app.errorLog.map((err: any, i: number) => (
                                  <li key={i} className="flex items-start gap-2 text-red-600">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                    <span>{err.step}: {err.error}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-gray-500 text-sm">No errors</p>
                            )}
                          </div>
                          <div>
                            <h4 className="font-medium text-gray-900 mb-2">Actions</h4>
                            <div className="flex flex-wrap gap-2">
                              {['submitted', 'interview', 'offer'].includes(app.status) && (
                                <>
                                  <select
                                    defaultValue={app.status}
                                    onChange={(e) => handleStatusChange(app._id, e.target.value)}
                                    className="input w-auto text-sm"
                                  >
                                    <option value="submitted">Mark Submitted</option>
                                    <option value="interview">Mark Interview</option>
                                    <option value="offer">Mark Offer</option>
                                    <option value="rejected">Mark Rejected</option>
                                    <option value="withdrawn">Withdraw</option>
                                  </select>
                                </>
                              )}
                              {app.status === 'failed' && (
                                <button onClick={() => handleRetry(app._id)} className="btn-secondary btn-sm">
                                  <RefreshCw className="w-4 h-4 mr-1" /> Retry
                                </button>
                              )}
                              {['pending', 'submitted'].includes(app.status) && (
                                <button onClick={() => handleWithdraw(app._id)} className="btn-ghost btn-sm text-red-600 hover:text-red-700">
                                  Withdraw
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </td>
              </tr>
            )}

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="p-4 border-t border-gray-200 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Showing {(pagination.page - 1) * pagination.limit + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))} disabled={pagination.page === 1} className="btn-outline btn-sm">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (pagination.totalPages <= 5) pageNum = i + 1;
                    else if (pagination.page <= 3) pageNum = i + 1;
                    else if (pagination.page >= pagination.totalPages - 2) pageNum = pagination.totalPages - 4 + i;
                    else pageNum = pagination.page - 2 + i;
                    return (
                      <button key={pageNum} onClick={() => setPagination(prev => ({ ...prev, page: pageNum }))} className={clsx('w-8 h-8 rounded-lg text-sm font-medium', pagination.page === pageNum ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100')}>
                        {pageNum}
                      </button>
                    );
                  })}
                  <button onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))} disabled={pagination.page === pagination.totalPages} className="btn-outline btn-sm">
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