import mongoose, { Document, Schema, Types, Model } from 'mongoose';

export interface IResumeContent {
  professionalSummary: string;
  skills: {
    technical: string[];
    soft: string[];
  };
  experience: Array<{
    company: string;
    position: string;
    startDate: Date;
    endDate?: Date;
    current: boolean;
    bullets: string[];
  }>;
  education: Array<{
    institution: string;
    degree: string;
    fieldOfStudy: string;
    highlights: string[];
  }>;
  projects: Array<{
    name: string;
    description: string;
    technologies: string[];
    relevance: string;
  }>;
  keywords: string[];
}

export interface IATSAnalysis {
  keywordMatch: number;
  formatScore: number;
  readabilityScore: number;
  missingKeywords: string[];
  suggestions: string[];
}

export interface IGeneratedResume extends Document {
  userId: string;
  jobPostingId: Types.ObjectId;
  version: number;
  content: IResumeContent;
  rawContent?: string;
  aiModel: string;
  aiProvider: string;
  atsScore?: number;
  atsAnalysis?: IATSAnalysis;
  pdfUrl?: string;
  latexSource?: string;
  status: 'draft' | 'reviewed' | 'approved' | 'submitted';
  createdAt: Date;
  updatedAt: Date;
}

export interface IGeneratedResumeModel extends Model<IGeneratedResume> {
  findLatestVersion(userId: string, jobPostingId: Types.ObjectId): mongoose.Query<IGeneratedResume | null, IGeneratedResume>;
  createNewVersion(
    userId: string,
    jobPostingId: Types.ObjectId,
    content: IResumeContent,
    aiModel: string,
    aiProvider: string
  ): Promise<IGeneratedResume>;
  getVersionHistory(userId: string, jobPostingId: Types.ObjectId): mongoose.Query<IGeneratedResume[], IGeneratedResume>;
}

const resumeContentSchema = new Schema<IResumeContent>({
  professionalSummary: { type: String, required: true, trim: true },
  skills: {
    technical: [{ type: String, trim: true }],
    soft: [{ type: String, trim: true }],
  },
  experience: [{
    company: { type: String, required: true, trim: true },
    position: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    current: { type: Boolean, default: false },
    bullets: [{ type: String, trim: true }],
  }],
  education: [{
    institution: { type: String, required: true, trim: true },
    degree: { type: String, required: true, trim: true },
    fieldOfStudy: { type: String, required: true, trim: true },
    highlights: [{ type: String, trim: true }],
  }],
  projects: [{
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    technologies: [{ type: String, trim: true }],
    relevance: { type: String, trim: true },
  }],
  keywords: [{ type: String, trim: true }],
}, { _id: false });

const atsAnalysisSchema = new Schema<IATSAnalysis>({
  keywordMatch: { type: Number, min: 0, max: 100 },
  formatScore: { type: Number, min: 0, max: 100 },
  readabilityScore: { type: Number, min: 0, max: 100 },
  missingKeywords: [{ type: String, trim: true }],
  suggestions: [{ type: String, trim: true }],
}, { _id: false });

const generatedResumeSchema = new Schema<IGeneratedResume>({
  userId: { type: String, required: true, index: true },
  jobPostingId: { type: Schema.Types.ObjectId, ref: 'JobPosting', required: true, index: true },
  version: { type: Number, required: true, default: 1 },
  content: { type: resumeContentSchema, required: true },
  aiModel: { type: String, required: true, trim: true },
  aiProvider: { type: String, required: true, trim: true },
  atsScore: { type: Number, min: 0, max: 100, index: true },
  atsAnalysis: { type: atsAnalysisSchema },
  rawContent: { type: String, trim: true },
  pdfUrl: { type: String, trim: true },
  latexSource: { type: String },
  status: {
    type: String,
    enum: ['draft', 'reviewed', 'approved', 'submitted'],
    default: 'draft',
    index: true,
  },
}, {
  timestamps: true,
  collection: 'generated_resumes',
});

// Compound index for user + job posting
generatedResumeSchema.index({ userId: 1, jobPostingId: 1, version: -1 });

// Virtual for latest version
generatedResumeSchema.statics.findLatestVersion = function(userId: string, jobPostingId: Types.ObjectId) {
  return this.findOne({ userId, jobPostingId })
    .sort({ version: -1 })
    .limit(1);
};

// Method to create new version
generatedResumeSchema.statics.createNewVersion = async function(
  userId: string,
  jobPostingId: Types.ObjectId,
  content: IResumeContent,
  aiModel: string,
  aiProvider: string
) {
  const latest = await (this as IGeneratedResumeModel).findLatestVersion(userId, jobPostingId);
  const newVersion = latest ? latest.version + 1 : 1;

  return this.create({
    userId,
    jobPostingId,
    version: newVersion,
    content,
    aiModel,
    aiProvider,
    status: 'draft',
  });
};

// Method to get version history
generatedResumeSchema.statics.getVersionHistory = function(userId: string, jobPostingId: Types.ObjectId) {
  return this.find({ userId, jobPostingId })
    .sort({ version: -1 })
    .select('version aiModel aiProvider atsScore status createdAt');
};

export const GeneratedResume = mongoose.model<IGeneratedResume, IGeneratedResumeModel>('GeneratedResume', generatedResumeSchema);
export default GeneratedResume;