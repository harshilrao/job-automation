import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapPin, Clock, DollarSign, Building2, ExternalLink, Star, FileText, PenTool, Loader2, AlertCircle, CheckCircle, ArrowLeft } from 'lucide-react';
import { api } from '../services/api';
import { JobPosting, GeneratedResume, CoverLetter } from '@shared/types';
import { formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';

export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobPosting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'details' | 'resume' | 'cover-letter' | 'apply'>('details');
  const [resumes, setResumes] = useState<GeneratedResume[]>([]);
  const [coverLetters, setCoverLetters] = useState<CoverLetter[]>([]);
  const [generating, setGenerating] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);

  useEffect(() => {
    if (id) {
      loadJob();
      loadResumes();
    }
  }, [id]);

  const loadJob = async () => {
    setLoading(true);
    try {
      const response = await api.getJobById(id!);
      setJob(response.job);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load job');
    } finally {
      setLoading(false);
    }
  };

  const loadResumes = async () => {
    try {
      const [resumesRes, coverLettersRes] = await Promise.all([
        api.getResumes({ jobPostingId: id! }),
        api.getCoverLetters({ jobPostingId: id! }),
      ]);
      setResumes(resumesRes.resumes);
      setCoverLetters(coverLettersRes.coverLetters);
    } catch (err) {
      console.error('Failed to load resumes:', err);
    }
  };

  const getSalaryDisplay = () => {
    if (!job) return 'Not specified';
    if (job.salaryMin && job.salaryMax) {
      return `$${job.salaryMin.toLocaleString()} - $${job.salaryMax.toLocaleString()}`;
    } else if (job.salaryMin) {
      return `$${job.salaryMin.toLocaleString()}+`;
    } else if (job.salaryMax) {
      return `Up to $${job.salaryMax.toLocaleString()}`;
    }
    return 'Not specified';
  };

  const getLocationDisplay = () => {
    if (!job) return '';
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

  const handleApply = async (resumeId?: string, coverLetterId?: string) => {
    if (!job) return;
    setApplyLoading(true);
    try {
      await api.applyToJob({
        jobPostingId: job._id,
        resumeId,
        coverLetterId,
      });
      navigate('/applications');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to apply');
    } finally {
      setApplyLoading(false);
    }
  };

  const handleGenerateResume = async () => {
    if (!job) return;
    setGenerating(true);
    try {
      await api.generateResume({
        jobPostingId: job._id,
        tone: 'professional',
      });
      loadResumes();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to generate resume');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-medium text-gray-900 mb-2">Failed to load job</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <button onClick={loadJob} className="btn-primary">Retry</button>
      </div>
    );
  }

  if (!job) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button onClick={() => navigate(-1)} className="btn-ghost btn-sm mb-4">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-2 mb-2">
            <span className={clsx('badge', getSourceColor(job.source))}>
              {job.source.charAt(0).toUpperCase() + job.source.slice(1)}
            </span>
            <span className="badge badge-gray">{job.jobType.replace('-', ' ')}</span>
            <span className="badge badge-gray">{job.experienceLevel.charAt(0).toUpperCase() + job.experienceLevel.slice(1)}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{job.title}</h1>
          <p className="text-gray-600">{job.company}</p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={job.applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Apply on {job.source.charAt(0).toUpperCase() + job.source.slice(1)}
          </a>
        </div>
      </div>

      {/* Quick Info */}
      <div className="card p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <Building2 className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Company</p>
              <p className="font-medium">{job.company}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <MapPin className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Location</p>
              <p className="font-medium">{getLocationDisplay()}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Salary</p>
              <p className="font-medium">{getSalaryDisplay()}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Posted</p>
              <p className="font-medium">{formatDistanceToNow(new Date(job.postedDate), { addSuffix: true })}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-8" aria-label="Tabs">
          {[
            { id: 'details', label: 'Details', icon: FileText },
            { id: 'resume', label: 'Resumes', icon: PenTool, count: resumes.length },
            { id: 'cover-letter', label: 'Cover Letters', icon: FileText, count: coverLetters.length },
            { id: 'apply', label: 'Apply', icon: ArrowLeft },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={clsx(
                'flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors',
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="bg-primary-100 text-primary-700 text-xs px-2 py-0.5 rounded-full">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="py-6">
        {activeTab === 'details' && (
          <div className="space-y-6">
            {/* Description */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Job Description</h3>
              <div className="prose prose-gray max-w-none">
                {job.descriptionHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: job.descriptionHtml }} />
                ) : (
                  <pre className="whitespace-pre-wrap text-gray-700">{job.description}</pre>
                )}
              </div>
            </div>

            {/* Requirements */}
            {job.requirements.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Requirements</h3>
                <ul className="space-y-2">
                  {job.requirements.map((req: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-gray-700">
                      <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      {req}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Responsibilities */}
            {job.responsibilities.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Responsibilities</h3>
                <ul className="space-y-2">
                  {job.responsibilities.map((resp: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-gray-700">
                      <Star className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                      {resp}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Skills */}
            {job.skills.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Required Skills</h3>
                <div className="flex flex-wrap gap-2">
                  {job.skills.map((skill: string) => (
                    <span key={skill} className="badge badge-primary">{skill}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Benefits */}
            {job.benefits && job.benefits.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Benefits</h3>
                <div className="flex flex-wrap gap-2">
                  {job.benefits.map((benefit: string) => (
                    <span key={benefit} className="badge badge-success">{benefit}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'resume' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Generated Resumes</h3>
              <button
                onClick={handleGenerateResume}
                disabled={generating}
                className="btn-primary btn-sm"
              >
                {generating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <PenTool className="w-4 h-4 mr-2" />
                    Generate Resume
                  </>
                )}
              </button>
            </div>

            {resumes.length === 0 ? (
              <div className="text-center py-12">
                <PenTool className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h4 className="text-lg font-medium text-gray-900 mb-2">No resumes yet</h4>
                <p className="text-gray-600 mb-4">Generate an AI-tailored resume for this job</p>
                <button onClick={handleGenerateResume} className="btn-primary">Generate Resume</button>
              </div>
            ) : (
              <div className="space-y-3">
                {resumes.map((resume) => (
                  <div key={resume._id} className="card p-4 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className={clsx('badge', resume.status === 'approved' ? 'badge-success' : 'badge-gray')}>
                          v{resume.version}
                        </span>
                        <span className="badge badge-gray">{resume.aiModel}</span>
                        {resume.atsScore !== undefined && (
                          <span className={clsx('badge', resume.atsScore >= 80 ? 'badge-success' : resume.atsScore >= 60 ? 'badge-warning' : 'badge-danger')}>
                            ATS: {resume.atsScore}%
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">Generated {formatDistanceToNow(new Date(resume.createdAt), { addSuffix: true })}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="btn-outline btn-sm">View</button>
                      <button className="btn-outline btn-sm">Download</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'cover-letter' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Cover Letters</h3>
            {coverLetters.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h4 className="text-lg font-medium text-gray-900 mb-2">No cover letters yet</h4>
                <p className="text-gray-600">Generate a cover letter after creating a resume</p>
              </div>
            ) : (
              <div className="space-y-3">
                {coverLetters.map((cl) => (
                  <div key={cl._id} className="card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="badge badge-gray">v{cl.version}</span>
                      <span className="badge badge-gray">{cl.tone}</span>
                    </div>
                    <p className="text-gray-700 line-clamp-3">{cl.content}</p>
                    <div className="flex items-center gap-2 mt-3">
                      <button className="btn-outline btn-sm">View Full</button>
                      <button className="btn-outline btn-sm">Download</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'apply' && (
          <div className="max-w-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Apply to this position</h3>
            <div className="card p-6 space-y-4">
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Select Resume</h4>
                <select className="input">
                  <option value="">Choose a resume...</option>
                  {resumes.map((r) => (
                    <option key={r._id} value={r._id}>
                      v{r.version} ({r.aiModel}) {r.atsScore !== undefined ? ` - ATS: ${r.atsScore}%` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Select Cover Letter (Optional)</h4>
                <select className="input">
                  <option value="">None</option>
                  {coverLetters.map((cl) => (
                    <option key={cl._id} value={cl._id}>
                      v{cl.version} ({cl.tone})
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => handleApply()}
                disabled={applyLoading || resumes.length === 0}
                className="btn-primary w-full"
              >
                {applyLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Submit Application'
                )}
              </button>
              <p className="text-sm text-gray-600 text-center">
                This will automatically fill and submit the application on {job.source.charAt(0).toUpperCase() + job.source.slice(1)}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}