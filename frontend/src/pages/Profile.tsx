import { useState, useEffect } from 'react';
import { useForm, useFieldArray, FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { User, Mail, Phone, Linkedin, Github, Globe, Briefcase, GraduationCap, FolderKanban, Loader2, AlertCircle, CheckCircle, Download, Upload, Plus, Trash2, Target } from 'lucide-react';
import { api } from '../services/api';
import { UserProfile } from '@shared/types';
import { clsx } from 'clsx';

const personalInfoSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email'),
  phone: z.string().min(10, 'Phone number required'),
  address: z.object({
    street: z.string().min(1, 'Street address required'),
    city: z.string().min(1, 'City required'),
    province: z.string().min(1, 'Province required'),
    postalCode: z.string().min(1, 'Postal code required'),
    country: z.string().default('Canada'),
  }),
  linkedinUrl: z.string().url().optional().or(z.literal('')),
  githubUrl: z.string().url().optional().or(z.literal('')),
  portfolioUrl: z.string().url().optional().or(z.literal('')),
});

const experienceSchema = z.object({
  company: z.string().min(1, 'Company required'),
  position: z.string().min(1, 'Position required'),
  startDate: z.string().min(1, 'Start date required'),
  endDate: z.string().optional(),
  current: z.boolean().default(false),
  description: z.array(z.string()).optional(),
  technologies: z.array(z.string()).optional(),
  location: z.string().optional(),
});

const educationSchema = z.object({
  institution: z.string().min(1, 'Institution required'),
  degree: z.string().min(1, 'Degree required'),
  fieldOfStudy: z.string().min(1, 'Field of study required'),
  startDate: z.string().min(1, 'Start date required'),
  endDate: z.string().optional(),
  gpa: z.string().optional(),
  honors: z.array(z.string()).optional(),
});

const projectSchema = z.object({
  name: z.string().min(1, 'Project name required'),
  description: z.string().min(1, 'Description required'),
  technologies: z.array(z.string()).optional(),
  url: z.string().url().optional().or(z.literal('')),
  githubUrl: z.string().url().optional().or(z.literal('')),
});

const preferencesSchema = z.object({
  desiredRoles: z.array(z.string()).optional(),
  desiredLocations: z.array(z.string()).optional(),
  salaryMin: z.number().min(0).optional(),
  salaryMax: z.number().min(0).optional(),
  jobTypes: z.array(z.string()).optional(),
  industries: z.array(z.string()).optional(),
  workAuthorization: z.string().optional(),
});

type PersonalInfoForm = z.infer<typeof personalInfoSchema>;
type ExperienceForm = z.infer<typeof experienceSchema>;
type EducationForm = z.infer<typeof educationSchema>;
type ProjectForm = z.infer<typeof projectSchema>;
type PreferencesForm = z.infer<typeof preferencesSchema>;

interface ExperienceFormValues extends FieldValues {
  experience: ExperienceForm[];
}
interface EducationFormValues extends FieldValues {
  education: EducationForm[];
}
interface ProjectsFormValues extends FieldValues {
  projects: ProjectForm[];
}

const ONTARIO_CITIES = [
  'Toronto', 'Ottawa', 'Mississauga', 'Brampton', 'Hamilton',
  'London', 'Markham', 'Vaughan', 'Windsor', 'Kitchener',
  'Oakville', 'Richmond Hill', 'Burlington', 'Oshawa', 'Barrie',
  'Guelph', 'St. Catharines', 'Kingston', 'Peterborough', 'Waterloo',
];

const JOB_TYPES = ['full-time', 'part-time', 'contract', 'internship', 'temporary', 'freelance'];
const INDUSTRIES = [
  'Technology', 'Financial Services', 'Healthcare', 'Manufacturing', 'Retail',
  'Education', 'Government', 'Consulting', 'Telecommunications', 'Media & Entertainment',
  'Real Estate', 'Transportation', 'Energy', 'Non-profit', 'Hospitality',
  'Construction', 'Automotive', 'Aerospace', 'Biotechnology', 'E-commerce',
];

export function Profile() {
  const [activeTab, setActiveTab] = useState<'personal' | 'experience' | 'education' | 'projects' | 'preferences' | 'summary'>('personal');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Personal Info Form
  const personalForm = useForm<PersonalInfoForm>({
    resolver: zodResolver(personalInfoSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      address: { street: '', city: '', province: 'ON', postalCode: '', country: 'Canada' },
      linkedinUrl: '',
      githubUrl: '',
      portfolioUrl: '',
    },
  });

  // Experience Form
  const experienceForm = useForm<ExperienceFormValues>({
    resolver: zodResolver(z.object({ experience: z.array(experienceSchema) })),
    defaultValues: { experience: [] },
  });
  const { fields: experiences, append: addExperience, remove: removeExperience, move: moveExperience } = useFieldArray({
    control: experienceForm.control,
    name: 'experience',
  });

  // Education Form
  const educationForm = useForm<EducationFormValues>({
    resolver: zodResolver(z.object({ education: z.array(educationSchema) })),
    defaultValues: { education: [] },
  });
  const { fields: education, append: addEducation, remove: removeEducation } = useFieldArray({
    control: educationForm.control,
    name: 'education',
  });

  // Projects Form
  const projectsForm = useForm<ProjectsFormValues>({
    resolver: zodResolver(z.object({ projects: z.array(projectSchema) })),
    defaultValues: { projects: [] },
  });
  const { fields: projects, append: addProject, remove: removeProject } = useFieldArray({
    control: projectsForm.control,
    name: 'projects',
  });

  // Preferences Form
  const preferencesForm = useForm<PreferencesForm>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: {
      desiredRoles: [],
      desiredLocations: [],
      salaryMin: undefined,
      salaryMax: undefined,
      jobTypes: [],
      industries: [],
      workAuthorization: '',
    },
  });

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    setLoading(true);
    try {
      const response = await api.getProfile();
      setProfile(response.profile);

      const p = response.profile;

      // Populate personal form
      personalForm.reset({
        firstName: p.personalInfo.firstName,
        lastName: p.personalInfo.lastName,
        email: p.personalInfo.email,
        phone: p.personalInfo.phone,
        address: p.personalInfo.address,
        linkedinUrl: p.personalInfo.linkedinUrl || '',
        githubUrl: p.personalInfo.githubUrl || '',
        portfolioUrl: p.personalInfo.portfolioUrl || '',
      });

      // Populate experience form
      experienceForm.reset({ experience: p.experience || [] });

      // Populate education form
      educationForm.reset({ education: p.education || [] });

      // Populate projects form
      projectsForm.reset({ projects: p.projects || [] });

      // Populate preferences form
      preferencesForm.reset({
        desiredRoles: p.preferences?.desiredRoles || [],
        desiredLocations: p.preferences?.desiredLocations || [],
        salaryMin: p.preferences?.salaryMin,
        salaryMax: p.preferences?.salaryMax,
        jobTypes: p.preferences?.jobTypes || [],
        industries: p.preferences?.industries || [],
        workAuthorization: p.preferences?.workAuthorization || '',
      });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSavePersonal = async (data: PersonalInfoForm) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api.updatePersonalInfo({ personalInfo: data });
      setSuccess('Personal information saved successfully!');
      loadProfile();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveExperience = async (data: ExperienceFormValues) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      // For experience, we need to send the whole array to the API
      // This assumes the backend has an endpoint to update experience
      await api.updateProfile({ experience: data.experience });
      setSuccess('Experience saved successfully!');
      loadProfile();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEducation = async (data: EducationFormValues) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api.updateProfile({ education: data.education });
      setSuccess('Education saved successfully!');
      loadProfile();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProjects = async (data: ProjectsFormValues) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api.updateProfile({ projects: data.projects });
      setSuccess('Projects saved successfully!');
      loadProfile();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePreferences = async (data: PreferencesForm) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api.updatePreferences({ preferences: data });
      setSuccess('Preferences saved successfully!');
      loadProfile();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSummary = async (summary: string) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api.updateProfessionalSummary(summary);
      setSuccess('Professional summary saved!');
      loadProfile();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await api.exportProfile();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'profile-export.json';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to export profile');
    }
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await api.importProfile(data);
      setSuccess('Profile imported successfully!');
      loadProfile();
    } catch (err) {
      setError('Failed to import profile');
    }
  };

  const tabs = [
    { id: 'personal', label: 'Personal Info', icon: User },
    { id: 'summary', label: 'Professional Summary', icon: Target },
    { id: 'experience', label: 'Experience', icon: Briefcase },
    { id: 'education', label: 'Education', icon: GraduationCap },
    { id: 'projects', label: 'Projects', icon: FolderKanban },
    { id: 'preferences', label: 'Preferences', icon: Target },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6" />
          <div className="card p-6">
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-4" />
            <div className="space-y-4">
              <div className="h-10 bg-gray-200 rounded" />
              <div className="h-10 bg-gray-200 rounded" />
              <div className="h-10 bg-gray-200 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
          <p className="text-gray-600 mt-1">Manage your professional profile and preferences</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="btn-outline btn-sm">
            <Download className="w-4 h-4 mr-2" />
            Export
          </button>
          <label className="btn-outline btn-sm cursor-pointer">
            <Upload className="w-4 h-4 mr-2" />
            Import
            <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])} />
          </label>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex items-center gap-2">
          <CheckCircle className="w-5 h-5" />
          {success}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6 overflow-x-auto" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={clsx(
                'flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-colors',
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="py-6">
        {activeTab === 'personal' && (
          <form onSubmit={personalForm.handleSubmit(handleSavePersonal)} className="space-y-6 max-w-3xl">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <User className="w-5 h-5" />
                Personal Information
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">First Name</label>
                <input {...personalForm.register('firstName')} className="input" />
                {personalForm.formState.errors.firstName && (
                  <p className="mt-1 text-sm text-red-600">{personalForm.formState.errors.firstName.message}</p>
                )}
              </div>
              <div>
                <label className="label">Last Name</label>
                <input {...personalForm.register('lastName')} className="input" />
                {personalForm.formState.errors.lastName && (
                  <p className="mt-1 text-sm text-red-600">{personalForm.formState.errors.lastName.message}</p>
                )}
              </div>
            </div>

            <div>
              <label className="label">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input {...personalForm.register('email')} type="email" className="input pl-10" />
              </div>
              {personalForm.formState.errors.email && (
                <p className="mt-1 text-sm text-red-600">{personalForm.formState.errors.email.message}</p>
              )}
            </div>

            <div>
              <label className="label">Phone</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input {...personalForm.register('phone')} type="tel" className="input pl-10" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Street Address</label>
                <input {...personalForm.register('address.street')} className="input" placeholder="123 Main St" />
              </div>
              <div>
                <label className="label">City</label>
                <input {...personalForm.register('address.city')} className="input" placeholder="Toronto" />
              </div>
              <div>
                <label className="label">Province</label>
                <input {...personalForm.register('address.province')} className="input" placeholder="ON" />
              </div>
              <div>
                <label className="label">Postal Code</label>
                <input {...personalForm.register('address.postalCode')} className="input" placeholder="M5V 3L9" />
              </div>
              <div>
                <label className="label">Country</label>
                <input {...personalForm.register('address.country')} className="input" placeholder="Canada" />
              </div>
            </div>

            <div>
              <label className="label">LinkedIn URL</label>
              <div className="relative">
                <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input {...personalForm.register('linkedinUrl')} type="url" className="input pl-10" placeholder="https://linkedin.com/in/yourname" />
              </div>
            </div>

            <div>
              <label className="label">GitHub URL</label>
              <div className="relative">
                <Github className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input {...personalForm.register('githubUrl')} type="url" className="input pl-10" placeholder="https://github.com/yourname" />
              </div>
            </div>

            <div>
              <label className="label">Portfolio URL</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input {...personalForm.register('portfolioUrl')} type="url" className="input pl-10" placeholder="https://yourportfolio.com" />
              </div>
            </div>

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Personal Info'}
            </button>
          </form>
        )}

        {activeTab === 'summary' && (
          <div className="max-w-3xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Target className="w-5 h-5" />
              Professional Summary
            </h3>
            <textarea
              value={profile?.professionalSummary || ''}
              onChange={(e) => handleSaveSummary(e.target.value)}
              className="input min-h-[150px] resize-y"
              placeholder="Write a compelling professional summary highlighting your key skills, experience, and career goals..."
            />
            <p className="text-sm text-gray-500 mt-2">This summary will be used in AI-generated resumes and cover letters.</p>
          </div>
        )}

        {activeTab === 'experience' && (
          <form onSubmit={experienceForm.handleSubmit(handleSaveExperience)} className="max-w-3xl space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Briefcase className="w-5 h-5" />
                Work Experience
              </h3>
              <button type="button" onClick={() => addExperience({
                company: '', position: '', startDate: '', endDate: '', current: false, description: [], technologies: [], location: ''
              })} className="btn-primary btn-sm">
                <Plus className="w-4 h-4 mr-2" /> Add Experience
              </button>
            </div>

            {experiences.map((experience, index) => (
              <div key={experience.id} className="card p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">Experience #{index + 1}</h4>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => index > 0 && moveExperience(index, index - 1)} className="btn-ghost btn-sm p-1">↑</button>
                    <button type="button" onClick={() => index < experiences.length - 1 && moveExperience(index, index + 1)} className="btn-ghost btn-sm p-1">↓</button>
                    <button type="button" onClick={() => removeExperience(index)} className="btn-ghost btn-sm p-1 text-red-600 hover:text-red-700">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Company</label>
                    <input
                      {...experienceForm.register(`experience.${index}.company`)}
                      className="input"
                      placeholder="Company name"
                    />
                  </div>
                  <div>
                    <label className="label">Position</label>
                    <input
                      {...experienceForm.register(`experience.${index}.position`)}
                      className="input"
                      placeholder="Job title"
                    />
                  </div>
                  <div>
                    <label className="label">Location</label>
                    <input
                      {...experienceForm.register(`experience.${index}.location`)}
                      className="input"
                      placeholder="City, Province"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label className="label">Start Date</label>
                      <input
                        {...experienceForm.register(`experience.${index}.startDate`)}
                        type="month"
                        className="input"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="label">End Date</label>
                      <input
                        {...experienceForm.register(`experience.${index}.endDate`)}
                        type="month"
                        className="input"
                        disabled={experienceForm.watch(`experience.${index}.current`)}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      {...experienceForm.register(`experience.${index}.current`)}
                      type="checkbox"
                      id={`current-${index}`}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <label htmlFor={`current-${index}`} className="text-sm text-gray-600">Currently working here</label>
                  </div>
                </div>

                <div>
                  <label className="label">Description (one per line)</label>
                  <textarea
                    {...experienceForm.register(`experience.${index}.description`)}
                    className="input min-h-[100px] resize-y"
                    placeholder="Key achievements and responsibilities, one per line"
                  />
                </div>

                <div>
                  <label className="label">Technologies (comma separated)</label>
                  <input
                    {...experienceForm.register(`experience.${index}.technologies`)}
                    className="input"
                    placeholder="React, TypeScript, Node.js, AWS"
                  />
                </div>
              </div>
            ))}

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Experience'}
            </button>
          </form>
        )}

        {activeTab === 'education' && (
          <form onSubmit={educationForm.handleSubmit(handleSaveEducation)} className="max-w-3xl space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <GraduationCap className="w-5 h-5" />
                Education
              </h3>
              <button type="button" onClick={() => addEducation({
                institution: '', degree: '', fieldOfStudy: '', startDate: '', endDate: '', gpa: '', honors: []
              })} className="btn-primary btn-sm">
                <Plus className="w-4 h-4 mr-2" /> Add Education
              </button>
            </div>

            {education.map((edu, index) => (
              <div key={edu.id} className="card p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">Education #{index + 1}</h4>
                  <button type="button" onClick={() => removeEducation(index)} className="btn-ghost btn-sm p-1 text-red-600 hover:text-red-700">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Institution</label>
                    <input {...educationForm.register(`education.${index}.institution`)} className="input" placeholder="University/College name" />
                  </div>
                  <div>
                    <label className="label">Degree</label>
                    <input {...educationForm.register(`education.${index}.degree`)} className="input" placeholder="e.g., Bachelor of Science" />
                  </div>
                  <div>
                    <label className="label">Field of Study</label>
                    <input {...educationForm.register(`education.${index}.fieldOfStudy`)} className="input" placeholder="e.g., Computer Science" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label className="label">Start Date</label>
                      <input {...educationForm.register(`education.${index}.startDate`)} type="month" className="input" />
                    </div>
                    <div className="flex-1">
                      <label className="label">End Date</label>
                      <input {...educationForm.register(`education.${index}.endDate`)} type="month" className="input" />
                    </div>
                  </div>
                  <div>
                    <label className="label">GPA (optional)</label>
                    <input {...educationForm.register(`education.${index}.gpa`)} className="input" placeholder="e.g., 3.8" />
                  </div>
                  <div>
                    <label className="label">Honors (comma separated)</label>
                    <input {...educationForm.register(`education.${index}.honors`)} className="input" placeholder="Dean's List, Scholarship" />
                  </div>
                </div>
              </div>
            ))}

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Education'}
            </button>
          </form>
        )}

        {activeTab === 'projects' && (
          <form onSubmit={projectsForm.handleSubmit(handleSaveProjects)} className="max-w-3xl space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FolderKanban className="w-5 h-5" />
                Projects
              </h3>
              <button type="button" onClick={() => addProject({ name: '', description: '', technologies: [], url: '', githubUrl: '' })} className="btn-primary btn-sm">
                <Plus className="w-4 h-4 mr-2" /> Add Project
              </button>
            </div>

            {projects.map((project, index) => (
              <div key={project.id} className="card p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">Project #{index + 1}</h4>
                  <button type="button" onClick={() => removeProject(index)} className="btn-ghost btn-sm p-1 text-red-600 hover:text-red-700">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Project Name</label>
                    <input {...projectsForm.register(`projects.${index}.name`)} className="input" placeholder="Project name" />
                  </div>
                  <div>
                    <label className="label">URL (optional)</label>
                    <input {...projectsForm.register(`projects.${index}.url`)} type="url" className="input" placeholder="https://project-demo.com" />
                  </div>
                  <div>
                    <label className="label">GitHub URL (optional)</label>
                    <input {...projectsForm.register(`projects.${index}.githubUrl`)} type="url" className="input" placeholder="https://github.com/user/repo" />
                  </div>
                </div>

                <div>
                  <label className="label">Description</label>
                  <textarea {...projectsForm.register(`projects.${index}.description`)} className="input min-h-[80px] resize-y" placeholder="Describe the project, your role, and key outcomes" />
                </div>

                <div>
                  <label className="label">Technologies (comma separated)</label>
                  <input {...projectsForm.register(`projects.${index}.technologies`)} className="input" placeholder="React, Python, Docker, PostgreSQL" />
                </div>
              </div>
            ))}

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Projects'}
            </button>
          </form>
        )}

        {activeTab === 'preferences' && (
          <form onSubmit={preferencesForm.handleSubmit(handleSavePreferences)} className="max-w-3xl space-y-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Target className="w-5 h-5" />
              Job Preferences
            </h3>

            <div>
              <label className="label">Desired Roles</label>
              <div className="flex flex-wrap gap-2">
                {['Software Engineer', 'Full Stack Developer', 'Backend Developer', 'Frontend Developer', 'DevOps Engineer', 'Data Scientist', 'ML Engineer', 'Engineering Manager', 'Technical Lead'].map(role => (
                  <label key={role} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border transition-colors cursor-pointer">
                    <input type="checkbox" {...preferencesForm.register('desiredRoles')} value={role} className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    {role}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Preferred Locations (Ontario)</label>
              <div className="flex flex-wrap gap-2">
                {ONTARIO_CITIES.map(city => (
                  <label key={city} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border transition-colors cursor-pointer">
                    <input type="checkbox" {...preferencesForm.register('desiredLocations')} value={city} className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    {city}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Minimum Salary (CAD)</label>
                <input {...preferencesForm.register('salaryMin', { valueAsNumber: true })} type="number" className="input" placeholder="80000" />
              </div>
              <div>
                <label className="label">Maximum Salary (CAD)</label>
                <input {...preferencesForm.register('salaryMax', { valueAsNumber: true })} type="number" className="input" placeholder="150000" />
              </div>
            </div>

            <div>
              <label className="label">Job Types</label>
              <div className="flex flex-wrap gap-2">
                {JOB_TYPES.map(type => (
                  <label key={type} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border transition-colors cursor-pointer">
                    <input type="checkbox" {...preferencesForm.register('jobTypes')} value={type} className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    {type.replace('-', ' ')}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Industries</label>
              <div className="flex flex-wrap gap-2">
                {INDUSTRIES.map(industry => (
                  <label key={industry} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border transition-colors cursor-pointer">
                    <input type="checkbox" {...preferencesForm.register('industries')} value={industry} className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    {industry}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Work Authorization</label>
              <select {...preferencesForm.register('workAuthorization')} className="input">
                <option value="Canadian Citizen">Canadian Citizen</option>
                <option value="Permanent Resident">Permanent Resident</option>
                <option value="Work Permit">Work Permit</option>
                <option value="Student Visa">Student Visa</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Preferences'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}