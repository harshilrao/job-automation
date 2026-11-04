import mongoose, { Document, Schema, Types, Model } from 'mongoose';

export interface ICoverLetter extends Document {
  userId: string;
  jobPostingId: Types.ObjectId;
  resumeId: Types.ObjectId;
  version: number;
  content: string;
  aiModel: string;
  aiProvider: string;
  tone: 'professional' | 'enthusiastic' | 'concise' | 'storytelling';
  status: 'draft' | 'reviewed' | 'approved' | 'submitted';
  createdAt: Date;
  updatedAt: Date;
}

export interface ICoverLetterModel extends Model<ICoverLetter> {
  findLatestVersion(userId: string, jobPostingId: Types.ObjectId): mongoose.Query<ICoverLetter | null, ICoverLetter>;
  createNewVersion(
    userId: string,
    jobPostingId: Types.ObjectId,
    resumeId: Types.ObjectId,
    content: string,
    aiModel: string,
    aiProvider: string,
    tone: 'professional' | 'enthusiastic' | 'concise' | 'storytelling'
  ): Promise<ICoverLetter>;
  getVersionHistory(userId: string, jobPostingId: Types.ObjectId): mongoose.Query<ICoverLetter[], ICoverLetter>;
}

const coverLetterSchema = new Schema<ICoverLetter>({
  userId: { type: String, required: true, index: true },
  jobPostingId: { type: Schema.Types.ObjectId, ref: 'JobPosting', required: true, index: true },
  resumeId: { type: Schema.Types.ObjectId, ref: 'GeneratedResume', required: true, index: true },
  version: { type: Number, required: true, default: 1 },
  content: { type: String, required: true },
  aiModel: { type: String, required: true, trim: true },
  aiProvider: { type: String, required: true, trim: true },
  tone: {
    type: String,
    enum: ['professional', 'enthusiastic', 'concise', 'storytelling'],
    default: 'professional',
  },
  status: {
    type: String,
    enum: ['draft', 'reviewed', 'approved', 'submitted'],
    default: 'draft',
    index: true,
  },
}, {
  timestamps: true,
  collection: 'cover_letters',
});

// Compound index
coverLetterSchema.index({ userId: 1, jobPostingId: 1, version: -1 });

// Virtual for word count
coverLetterSchema.virtual('wordCount').get(function() {
  return this.content.split(/\s+/).filter((word: string) => word.length > 0).length;
});

// Virtual for character count
coverLetterSchema.virtual('charCount').get(function() {
  return this.content.length;
});

// Static method to find latest version
coverLetterSchema.statics.findLatestVersion = function(userId: string, jobPostingId: Types.ObjectId) {
  return (this as ICoverLetterModel).findOne({ userId, jobPostingId })
    .sort({ version: -1 })
    .limit(1);
};

// Static method to create new version
coverLetterSchema.statics.createNewVersion = async function(
  userId: string,
  jobPostingId: Types.ObjectId,
  resumeId: Types.ObjectId,
  content: string,
  aiModel: string,
  aiProvider: string,
  tone: 'professional' | 'enthusiastic' | 'concise' | 'storytelling' = 'professional'
) {
  const latest = await (this as ICoverLetterModel).findLatestVersion(userId, jobPostingId);
  const newVersion = latest ? latest.version + 1 : 1;

  return this.create({
    userId,
    jobPostingId,
    resumeId,
    version: newVersion,
    content,
    aiModel,
    aiProvider,
    tone,
    status: 'draft',
  });
};

// Static method to get version history
coverLetterSchema.statics.getVersionHistory = function(userId: string, jobPostingId: Types.ObjectId) {
  return this.find({ userId, jobPostingId })
    .sort({ version: -1 })
    .select('version aiModel aiProvider tone status createdAt');
};

export const CoverLetter = mongoose.model<ICoverLetter, ICoverLetterModel>('CoverLetter', coverLetterSchema);
export default CoverLetter;