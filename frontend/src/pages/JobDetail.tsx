import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapPin, Clock, DollarSign, Building2, ExternalLink, Star, FileText, PenTool, Loader2, AlertCircle, CheckCircle, ArrowLeft, X, Upload } from 'lucide-react';
import { api } from '../services/api';
import { JobPosting, GeneratedResume, CoverLetter } from '@shared/types';
import { formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';
import jsPDF from 'jspdf';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

const DOWNLOAD_FORMATS: ('markdown' | 'pdf' | 'docx')[] = ['markdown', 'pdf', 'docx'];

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
  const [viewModal, setViewModal] = useState<{
    type: 'resume' | 'cover-letter';
    id: string;
    title: string;
    content: string;
  } | null>(null);
  const [downloadFormat, setDownloadFormat] = useState<'markdown' | 'pdf' | 'docx'>('markdown');
  const [uploadingResume, setUploadingResume] = useState(false);
  const [baseResumeText, setBaseResumeText] = useState<string>('');

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
        baseResumeText: baseResumeText || undefined,
      });
      loadResumes();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to generate resume');
    } finally {
      setGenerating(false);
    }
  };

  const handleViewResume = async (id: string) => {
    try {
      const response = await api.getResumeById(id);
      const resume = response.resume;
      setViewModal({
        type: 'resume',
        id,
        title: `Resume v${resume.version}`,
        content: resume.rawContent || JSON.stringify(resume.content, null, 2),
      });
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to load resume');
    }
  };

  const handleViewCoverLetter = (cl: CoverLetter) => {
    setViewModal({
      type: 'cover-letter',
      id: cl._id,
      title: `Cover Letter v${cl.version} (${cl.tone})`,
      content: cl.content,
    });
  };

  const handleDownloadCoverLetter = (cl: CoverLetter) => {
    downloadFile(cl.content, `cover-letter-v${cl.version}.md`);
  };

  const closeModal = () => {
    setViewModal(null);
  };

  const buildResumeMarkdown = (resume: any): string => {
    const c = resume.content;
    let md = `# Resume v${resume.version}\n\n`;
    md += `**Model:** ${resume.aiModel}  \n`;
    md += `**Provider:** ${resume.aiProvider}  \n`;
    md += `**ATS Score:** ${resume.atsScore ?? 'N/A'}  \n`;
    md += `**Status:** ${resume.status}  \n`;
    md += `**Generated:** ${new Date(resume.createdAt).toLocaleString()}  \n\n`;
    if (c.professionalSummary) md += `## Professional Summary\n\n${c.professionalSummary}\n\n`;
    if (c.skills?.technical?.length) md += `## Technical Skills\n\n${c.skills.technical.join(', ')}\n\n`;
    if (c.skills?.soft?.length) md += `## Soft Skills\n\n${c.skills.soft.join(', ')}\n\n`;
    if (c.experience?.length) {
      md += `## Professional Experience\n\n`;
      c.experience.forEach((exp: any) => {
        md += `### ${exp.position} at ${exp.company}\n\n`;
        md += `${exp.startDate?.toLocaleDateString?.() || ''} – ${exp.current ? 'Present' : exp.endDate?.toLocaleDateString?.() || ''}\n\n`;
        exp.bullets?.forEach((b: string) => md += `- ${b}\n`);
        md += `\n`;
      });
    }
    if (c.education?.length) {
      md += `## Education\n\n`;
      c.education.forEach((edu: any) => {
        md += `### ${edu.degree} - ${edu.institution}\n\n`;
        md += `${edu.fieldOfStudy}\n\n`;
        edu.highlights?.forEach((h: string) => md += `- ${h}\n`);
        md += `\n`;
      });
    }
    if (c.projects?.length) {
      md += `## Projects\n\n`;
      c.projects.forEach((p: any) => {
        md += `### ${p.name}\n\n${p.description}\n\n`;
      });
    }
    return md;
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadAsPDF = (content: string, filename: string) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width || 210;
    const pageHeight = doc.internal.pageSize.height || 297;
    const margin = 16;
    const usableWidth = pageWidth - margin * 2;

    doc.setFont('helvetica');

    const FONT = {
      h1: { size: 16, lineHeight: 1.3, after: 8 },
      h2: { size: 13, lineHeight: 1.3, after: 6 },
      h3: { size: 11.5, lineHeight: 1.3, after: 5 },
      body: { size: 10, lineHeight: 1.5, after: 5 },
    } as const;

    let y = margin;

    const needsPage = (height: number) => {
      if (y + height > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
    };

    const parseRuns = (text: string) =>
      text.split('**').map((part, i) => ({ text: part, bold: i % 2 === 1 }));

    const drawRuns = (x: number, yy: number, runs: { text: string; bold: boolean }[], size: number) => {
      let cx = x;
      doc.setFontSize(size);
      runs.forEach((r) => {
        doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
        doc.text(r.text, cx, yy);
        cx += doc.getTextWidth(r.text);
      });
    };

    const renderBlock = (text: string, kind: keyof typeof FONT) => {
      const { size, lineHeight: lh, after } = FONT[kind];
      const lineHeight = size * lh;

      doc.setFontSize(size);
      const wrapped = (doc.splitTextToSize(text, usableWidth) || []) as string[];

      needsPage(lineHeight + after);

      wrapped.forEach((line, i) => {
        if (i > 0) {
          needsPage(lineHeight);
          y += lineHeight;
        }
        const runs = parseRuns(line);
        drawRuns(margin, y, runs, size);
        y += lineHeight;
      });

      y += after;
    };

    // Split into paragraphs on blank lines so spacing is preserved
    const paragraphs = content.split(/\n\s*\n/);

    paragraphs.forEach((para, idx) => {
      const trimmed = para.trim();
      if (!trimmed) return;

      const lines = trimmed.split('\n');
      const first = lines[0].trim();

      if (first.startsWith('# ')) {
        renderBlock(first.replace(/^#\s*/, ''), 'h1');
      } else if (first.startsWith('## ')) {
        renderBlock(first.replace(/^##\s*/, ''), 'h2');
      } else if (first.startsWith('### ')) {
        renderBlock(first.replace(/^###\s*/, ''), 'h3');
      } else {
        const bodyText = lines.map((l) => l.trim()).join(' ');
        renderBlock(bodyText, 'body');
      }

      // small gap between paragraphs
      if (idx < paragraphs.length - 1) {
        y += 3;
        needsPage(0);
      }
    });

    doc.save(filename);
  };

  const downloadAsDOCX = async (content: string, filename: string) => {
    // Sizes in half-points (docx unit): 22 = 11pt
    const SIZE = {
      title: 28, // 14pt
      h1: 26, // 13pt
      h2: 24, // 12pt
      h3: 22, // 11pt
      body: 22, // 11pt
      bullet: 22, // 11pt
    } as const;

    const SPACING = {
      title: { before: 0, after: 200, line: 340, lineRule: 'auto' as const },
      h1: { before: 140, after: 100, line: 300, lineRule: 'auto' as const },
      h2: { before: 120, after: 80, line: 300, lineRule: 'auto' as const },
      h3: { before: 100, after: 60, line: 300, lineRule: 'auto' as const },
      body: { before: 0, after: 100, line: 330, lineRule: 'auto' as const },
      bullet: { before: 0, after: 50, line: 300, lineRule: 'auto' as const },
    } as const;

    const parseRuns = (text: string) =>
      text.split('**').map((part, i) => ({ text: part, bold: i % 2 === 1 }));

    const makeRuns = (t: string, size: number) =>
      parseRuns(t).map((r) => new TextRun({ text: r.text, bold: r.bold, size, font: 'Calibri' }));

    // Split into paragraphs on blank lines so spacing is preserved
    const blocks = content.split(/\n\s*\n/);

    const children: any[] = [];

    blocks.forEach((block) => {
      const trimmed = block.trim();
      if (!trimmed) return;

      const lines = trimmed.split('\n');
      const first = lines[0].trim();

      if (first.startsWith('# ')) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: makeRuns(first.replace(/^#\s*/, ''), SIZE.title),
            spacing: SPACING.title,
          })
        );
      } else if (first.startsWith('## ')) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: makeRuns(first.replace(/^##\s*/, ''), SIZE.h1),
            spacing: SPACING.h1,
          })
        );
      } else if (first.startsWith('### ')) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: makeRuns(first.replace(/^###\s*/, ''), SIZE.h2),
            spacing: SPACING.h2,
          })
        );
      } else if (first.startsWith('#### ')) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: makeRuns(first.replace(/^####\s*/, ''), SIZE.h3),
            spacing: SPACING.h3,
          })
        );
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        // Bullets: each line becomes its own bullet paragraph
        lines.forEach((line) => {
          const t = line.trim();
          if (!t) return;
          children.push(
            new Paragraph({
              children: makeRuns(t.replace(/^[-*]\s/, '• '), SIZE.bullet),
              bullet: { level: 0 },
              spacing: SPACING.bullet,
              indent: { left: 360 },
            })
          );
        });
      } else if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        // Table row: render cells separated, header row bold
        const cells = trimmed
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
        if (cells.length > 0) {
          const isHeader = cells.every((c) => c === c.toUpperCase());
          children.push(
            new Paragraph({
              children: cells.map((cell, i) =>
                new TextRun({
                  text: cell + (i < cells.length - 1 ? '   |   ' : ''),
                  bold: isHeader,
                  size: SIZE.body,
                  font: 'Calibri',
                })
              ),
              spacing: SPACING.body,
              indent: { left: 360 },
            })
          );
        }
      } else {
        // Body paragraph: join wrapped lines with a space
        const bodyText = lines.map((l) => l.trim()).filter(Boolean).join(' ');
        children.push(
          new Paragraph({
            children: makeRuns(bodyText, SIZE.body),
            spacing: SPACING.body,
          })
        );
      }
    });

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, // 1 inch
            },
          },
          children,
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadResume = async (id: string) => {
    try {
      const response = await api.getResumeById(id);
      const resume = response.resume;

      // Prefer raw AI-generated content (full readable resume) over structured object
      const content = resume.rawContent || buildResumeMarkdown(resume);

      switch (downloadFormat) {
        case 'pdf': {
          downloadAsPDF(content, `resume-v${resume.version}.pdf`);
          break;
        }
        case 'docx': {
          await downloadAsDOCX(content, `resume-v${resume.version}.docx`);
          break;
        }
        default: {
          downloadFile(content, `resume-v${resume.version}.md`);
          break;
        }
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to download resume');
    }
  };

  const handleUploadResume = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingResume(true);
    try {
      const formData = new FormData();
      formData.append('resume', file);

      const response = await api.uploadResume(formData);
      const extractedText = response.text || response.extractedText || '';
      setBaseResumeText(extractedText);
      alert('Resume uploaded successfully! AI will use it when generating your resume.');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to upload resume');
    } finally {
      setUploadingResume(false);
      e.target.value = '';
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
            <div className="space-y-4">
              {/* Upload your resume */}
              <div className="card p-4 bg-blue-50 border-blue-100">
                <div className="flex items-start gap-3">
                  <Upload className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-blue-900 mb-1">Use your own resume</h4>
                    <p className="text-sm text-blue-700 mb-3">
                      Upload your existing resume (PDF, DOCX, TXT) so AI can tailor it to this job.
                    </p>
                    <input
                      type="file"
                      accept=".pdf,.docx,.doc,.txt"
                      onChange={handleUploadResume}
                      disabled={uploadingResume}
                      className="block w-full text-sm text-blue-600 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200"
                    />
                    {baseResumeText && (
                      <div className="mt-3 p-2 bg-blue-100 rounded text-xs text-blue-800">
                        ✓ Resume loaded ({baseResumeText.length} characters)
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Header with download format + generate */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">Download format:</span>
                  {DOWNLOAD_FORMATS.map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setDownloadFormat(fmt)}
                      className={clsx(
                        'text-xs px-2 py-1 rounded border',
                        downloadFormat === fmt
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                      )}
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
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
                      <button
                        onClick={() => handleViewResume(resume._id)}
                        className="btn-outline btn-sm"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleDownloadResume(resume._id)}
                        className="btn-outline btn-sm"
                      >
                        Download
                      </button>
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
                      <button
                        onClick={() => handleViewCoverLetter(cl)}
                        className="btn-outline btn-sm"
                      >
                        View Full
                      </button>
                      <button
                        onClick={() => handleDownloadCoverLetter(cl)}
                        className="btn-outline btn-sm"
                      >
                        Download
                      </button>
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

        {/* View Modal */}
        {viewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={closeModal}>
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={(e) => e.stopPropagation()} />
            <div className="relative bg-white w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-lg shadow-2xl border border-gray-200 mx-4">
              <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50">
                <h3 className="text-lg font-semibold text-gray-900">{viewModal.title}</h3>
                <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[75vh]">
                <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap break-words font-mono text-sm">
                  {viewModal.content}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}