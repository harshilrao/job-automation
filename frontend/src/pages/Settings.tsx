import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Shield, Bell, Palette, Database, Key, Trash2, Loader2, AlertCircle, CheckCircle, ExternalLink, Cpu, Sparkles, Download } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../services/api';

const settingsSchema = z.object({
  emailNotifications: z.boolean().default(true),
  applicationUpdates: z.boolean().default(true),
  weeklyDigest: z.boolean().default(false),
  marketingEmails: z.boolean().default(false),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  autoApplyEnabled: z.boolean().default(false),
  maxApplicationsPerDay: z.number().min(1).max(50).default(5),
  preferredAiModel: z.string().default('free-claude'),
  resumeTone: z.enum(['professional', 'enthusiastic', 'concise', 'storytelling']).default('professional'),
  coverLetterTone: z.enum(['professional', 'enthusiastic', 'concise', 'storytelling']).default('professional'),
});

type SettingsForm = z.infer<typeof settingsSchema>;

const AI_MODELS = [
  { id: 'free-claude', name: 'Free Claude (via free-claude-code)', provider: 'free-claude-code' },
  { id: 'openrouter/free', name: 'OpenRouter Free Models', provider: 'openrouter' },
  { id: 'groq/llama-3.3-70b-versatile', name: 'Groq Llama 3.3 70B', provider: 'groq' },
  { id: 'nvidia_nim/nvidia/nemotron-3-ultra-550b-a55b', name: 'NVIDIA Nemotron 3 Ultra', provider: 'free-claude-code' },
  { id: 'gemini/models/gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', provider: 'free-claude-code' },
];

export function Settings() {
  const [activeTab, setActiveTab] = useState<'notifications' | 'appearance' | 'ai' | 'automation' | 'account' | 'danger'>('notifications');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [aiModels, setAiModels] = useState<Array<{ id: string; name: string; provider: string }>>(AI_MODELS);

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      emailNotifications: true,
      applicationUpdates: true,
      weeklyDigest: false,
      marketingEmails: false,
      theme: 'system',
      autoApplyEnabled: false,
      maxApplicationsPerDay: 5,
      preferredAiModel: 'free-claude',
      resumeTone: 'professional',
      coverLetterTone: 'professional',
    },
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      // Fetch available AI models from the backend
      const response = await api.getAvailableModels();
      const backendModels = (response.models || []) as Array<{ id: string; name: string; provider: string }>;
      if (backendModels.length > 0) {
        setAiModels(backendModels);
      }
      // Load persisted settings from localStorage
      const saved = localStorage.getItem('job-automation-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        form.reset(parsed as Partial<SettingsForm>);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
      setAiModels(AI_MODELS);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (data: SettingsForm) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      // Persist settings locally so preferences survive reloads
      localStorage.setItem('job-automation-settings', JSON.stringify(data));
      setSuccess('Settings saved successfully!');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm('Are you sure you want to delete your account? This action cannot be undone.')) return;
    if (!confirm('This will permanently delete all your data including applications, resumes, and profile. Continue?')) return;

    setSaving(true);
    try {
      // In a real app, you'd DELETE /api/account
      await new Promise(resolve => setTimeout(resolve, 1000));
      alert('Account deleted successfully');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete account');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'ai', label: 'AI Models', icon: Sparkles },
    { id: 'automation', label: 'Automation', icon: Cpu },
    { id: 'account', label: 'Account', icon: Shield },
    { id: 'danger', label: 'Danger Zone', icon: Trash2 },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6" />
          <div className="card p-6">
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
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">Manage your preferences and account settings</p>
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
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
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
      <form onSubmit={form.handleSubmit(handleSubmit)} className="py-6 space-y-6">
        {activeTab === 'notifications' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Email Notifications
            </h2>
            <div className="space-y-4">
              <label className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                <input type="checkbox" {...form.register('emailNotifications')} className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <div>
                  <p className="font-medium text-gray-900">Enable email notifications</p>
                  <p className="text-sm text-gray-500">Receive emails for important updates</p>
                </div>
              </label>
              <label className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                <input type="checkbox" {...form.register('applicationUpdates')} className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <div>
                  <p className="font-medium text-gray-900">Application status updates</p>
                  <p className="text-sm text-gray-500">Get notified when application status changes</p>
                </div>
              </label>
              <label className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                <input type="checkbox" {...form.register('weeklyDigest')} className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <div>
                  <p className="font-medium text-gray-900">Weekly digest</p>
                  <p className="text-sm text-gray-500">Receive a weekly summary of new job matches</p>
                </div>
              </label>
              <label className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                <input type="checkbox" {...form.register('marketingEmails')} className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                <div>
                  <p className="font-medium text-gray-900">Marketing emails</p>
                  <p className="text-sm text-gray-500">Receive tips, updates, and product news</p>
                </div>
              </label>
            </div>
          </div>
        )}

        {activeTab === 'appearance' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Palette className="w-5 h-5" />
              Appearance
            </h2>
            <div className="space-y-6">
              <div>
                <label className="label">Theme</label>
                <select {...form.register('theme')} className="input max-w-xs">
                  <option value="system">System (auto)</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
                <p className="text-sm text-gray-500 mt-1">Choose your preferred color theme</p>
              </div>

              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <h3 className="font-medium text-gray-900 mb-2">Preview</h3>
                <div className="flex items-center gap-4">
                  <div className="w-24 h-16 bg-white border border-gray-200 rounded p-2">
                    <div className="h-4 bg-gray-100 rounded mb-2" />
                    <div className="h-3 bg-gray-200 rounded w-3/4" />
                    <div className="h-3 bg-gray-200 rounded w-1/2 mt-1" />
                  </div>
                  <div className="w-24 h-16 bg-gray-900 border border-gray-700 rounded p-2">
                    <div className="h-4 bg-gray-800 rounded mb-2" />
                    <div className="h-3 bg-gray-700 rounded w-3/4" />
                    <div className="h-3 bg-gray-700 rounded w-1/2 mt-1" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'ai' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              AI Model Configuration
            </h2>

            <div className="space-y-6">
              <div>
                <label className="label">Preferred AI Model</label>
                <select {...form.register('preferredAiModel')} className="input max-w-md">
                  {aiModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ({model.provider})
                    </option>
                  ))}
                </select>
                <p className="text-sm text-gray-500 mt-1">Select the AI model for resume and cover letter generation</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="label">Resume Tone</label>
                  <select {...form.register('resumeTone')} className="input max-w-xs">
                    <option value="professional">Professional</option>
                    <option value="enthusiastic">Enthusiastic</option>
                    <option value="concise">Concise</option>
                    <option value="storytelling">Storytelling</option>
                  </select>
                  <p className="text-sm text-gray-500 mt-1">Default tone for generated resumes</p>
                </div>
                <div>
                  <label className="label">Cover Letter Tone</label>
                  <select {...form.register('coverLetterTone')} className="input max-w-xs">
                    <option value="professional">Professional</option>
                    <option value="enthusiastic">Enthusiastic</option>
                    <option value="concise">Concise</option>
                    <option value="storytelling">Storytelling</option>
                  </select>
                  <p className="text-sm text-gray-500 mt-1">Default tone for generated cover letters</p>
                </div>
              </div>

              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="font-medium text-blue-900 mb-2 flex items-center gap-2">
                  <ExternalLink className="w-4 h-4" />
                  Free Claude Code Integration
                </h3>
                <p className="text-blue-800 text-sm mb-2">
                  This application integrates with <a href="https://github.com/alishahryar1/free-claude-code" target="_blank" rel="noopener noreferrer" className="underline">free-claude-code</a> for free AI access.
                </p>
                <ul className="text-blue-800 text-sm space-y-1">
                  <li>• Install: <code className="bg-blue-100 px-1 rounded">fcc-server</code> to start local AI server</li>
                  <li>• Configure providers in Admin UI (OpenRouter, Groq, etc.)</li>
                  <li>• Select model from dropdown above</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'automation' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Cpu className="w-5 h-5" />
              Automation Settings
            </h2>

            <div className="space-y-6">
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" {...form.register('autoApplyEnabled')} className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <div>
                    <p className="font-medium text-gray-900">Enable auto-apply</p>
                    <p className="text-sm text-gray-500">Automatically apply to matched jobs (requires review)</p>
                  </div>
                </label>
              </div>

              <div>
                <label className="label">Max Applications Per Day</label>
                <input type="number" {...form.register('maxApplicationsPerDay', { valueAsNumber: true })} min={1} max={50} className="input max-w-xs" />
                <p className="text-sm text-gray-500 mt-1">Limit daily automated applications</p>
              </div>

              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <h3 className="font-medium text-amber-900 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Important Notes
                </h3>
                <ul className="text-amber-800 text-sm space-y-1">
                  <li>• Auto-apply will fill forms but requires human confirmation before submission</li>
                  <li>• CAPTCHAs and login prompts will pause automation for manual intervention</li>
                  <li>• Always review generated resumes and cover letters before applying</li>
                  <li>• Some sites may block automated browsers - use responsibly</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'account' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Account Settings
            </h2>

            <div className="space-y-6">
              <div className="card p-6">
                <h3 className="font-medium text-gray-900 mb-4">Profile Information</h3>
                <p className="text-gray-600 mb-4">Manage your personal information from the <a href="/profile" className="text-primary-600 hover:underline">Profile page</a>.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">Email</p>
                    <p className="font-medium text-gray-900">user@example.com</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">Member since</p>
                    <p className="font-medium text-gray-900">January 2024</p>
                  </div>
                </div>
              </div>

              <div className="card p-6">
                <h3 className="font-medium text-gray-900 mb-4">Connected Services</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Sparkles className="w-5 h-5 text-primary-600" />
                      <span className="font-medium">Free Claude Code</span>
                    </div>
                    <span className="badge badge-success">Connected</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Database className="w-5 h-5 text-gray-600" />
                      <span className="font-medium">MongoDB Atlas</span>
                    </div>
                    <span className="badge badge-success">Connected</span>
                  </div>
                </div>
              </div>

              <div className="card p-6">
                <h3 className="font-medium text-gray-900 mb-4">API Keys</h3>
                <p className="text-gray-600 mb-4">Configure API keys for additional AI providers (stored securely)</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Key className="w-5 h-5 text-gray-600" />
                      <span className="font-medium">OpenRouter API</span>
                    </div>
                    <button className="btn-outline btn-sm">Configure</button>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Key className="w-5 h-5 text-gray-600" />
                      <span className="font-medium">Groq API</span>
                    </div>
                    <button className="btn-outline btn-sm">Configure</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'danger' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-600" />
              Danger Zone
            </h2>

            <div className="space-y-6">
              <div className="card p-6 border-red-200 bg-red-50">
                <div className="flex items-start gap-4">
                  <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-medium text-red-900 mb-1">Delete All Application Data</h3>
                    <p className="text-red-700 text-sm mb-4">
                      This will permanently delete all your job applications, generated resumes, cover letters, and application history. Your profile and preferences will be kept.
                    </p>
                    <button type="button" className="btn-danger">Delete Application Data</button>
                  </div>
                </div>
              </div>

              <div className="card p-6 border-red-200 bg-red-50">
                <div className="flex items-start gap-4">
                  <Trash2 className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-medium text-red-900 mb-1">Delete Account</h3>
                    <p className="text-red-700 text-sm mb-4">
                      This will permanently delete your account and ALL associated data including profile, preferences, applications, resumes, and cover letters. This action cannot be undone.
                    </p>
                    <button type="button" onClick={handleDeleteAccount} disabled={saving} className="btn-danger">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete Account Permanently'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="card p-6">
                <h3 className="font-medium text-gray-900 mb-4">Export All Data</h3>
                <p className="text-gray-600 mb-4">Download a complete backup of your data before making irreversible changes.</p>
                <button type="button" className="btn-outline">
                  <Download className="w-4 h-4 mr-2" />
                  Export All Data
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Save Button */}
        <div className="flex justify-end pt-6 border-t border-gray-200">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}