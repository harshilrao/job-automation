import mongoose, { Document, Schema, Types, Model } from 'mongoose';

export interface ISubmissionData {
  formFields: Record<string, any>;
  screenshots: string[];
  confirmationNumber?: string;
  confirmationEmail?: string;
}

export interface IErrorLog {
  step: string;
  error: string;
  timestamp: Date;
  resolved: boolean;
}

export interface IApplicationRecord extends Document {
  userId: string;
  jobPostingId: Types.ObjectId;
  resumeId: Types.ObjectId;
  coverLetterId?: Types.ObjectId;
  status: 'pending' | 'in-progress' | 'submitted' | 'failed' | 'rejected' | 'interview' | 'offer' | 'withdrawn';
  applicationUrl: string;
  applicationMethod: 'automated' | 'manual' | 'hybrid';
  atsPlatform?: string;
  submissionData: ISubmissionData;
  errorLog: IErrorLog[];
  humanInterventionRequired: boolean;
  interventionReason?: string;
  appliedAt?: Date;
  responseReceivedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IApplicationRecordModel extends Model<IApplicationRecord> {
  hasApplied(userId: string, jobPostingId: Types.ObjectId): Promise<boolean>;
  getStats(userId: string): Promise<{
    total: number;
    pending: number;
    inProgress: number;
    submitted: number;
    failed: number;
    rejected: number;
    interview: number;
    offer: number;
    withdrawn: number;
  }>;
  getNeedingIntervention(userId: string): mongoose.Query<IApplicationRecord[], IApplicationRecord>;
}

export interface IApplicationRecordDocument extends IApplicationRecord {
  addError(step: string, error: string): Promise<IApplicationRecord>;
  resolveError(step: string): Promise<IApplicationRecord>;
  updateStatus(status: IApplicationRecord['status'], additionalData?: Partial<IApplicationRecord>): Promise<IApplicationRecord>;
}

const submissionDataSchema = new Schema<ISubmissionData>({
  formFields: { type: Schema.Types.Mixed, default: {} },
  screenshots: [{ type: String }],
  confirmationNumber: { type: String, trim: true },
  confirmationEmail: { type: String, trim: true },
}, { _id: false });

const errorLogSchema = new Schema<IErrorLog>({
  step: { type: String, required: true, trim: true },
  error: { type: String, required: true },
  timestamp: { type: Date, required: true, default: Date.now },
  resolved: { type: Boolean, default: false },
}, { _id: false });

const applicationRecordSchema = new Schema<IApplicationRecord>({
  userId: { type: String, required: true, index: true },
  jobPostingId: { type: Schema.Types.ObjectId, ref: 'JobPosting', required: true, index: true },
  resumeId: { type: Schema.Types.ObjectId, ref: 'GeneratedResume', required: true, index: true },
  coverLetterId: { type: Schema.Types.ObjectId, ref: 'CoverLetter', index: true },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'submitted', 'failed', 'rejected', 'interview', 'offer', 'withdrawn'],
    default: 'pending',
    index: true,
  },
  applicationUrl: { type: String, required: true, trim: true },
  applicationMethod: {
    type: String,
    enum: ['automated', 'manual', 'hybrid'],
    default: 'automated',
  },
  atsPlatform: { type: String, trim: true, index: true },
  submissionData: { type: submissionDataSchema, default: () => ({}) },
  errorLog: { type: [errorLogSchema], default: [] },
  humanInterventionRequired: { type: Boolean, default: false, index: true },
  interventionReason: { type: String, trim: true },
  appliedAt: { type: Date, index: true },
  responseReceivedAt: { type: Date, index: true },
  notes: { type: String, trim: true },
}, {
  timestamps: true,
  collection: 'application_records',
});

// Indexes
applicationRecordSchema.index({ userId: 1, status: 1 });
applicationRecordSchema.index({ userId: 1, createdAt: -1 });
applicationRecordSchema.index({ jobPostingId: 1, userId: 1 }, { unique: true }); // Prevent duplicate applications
applicationRecordSchema.index({ appliedAt: -1 });
applicationRecordSchema.index({ humanInterventionRequired: 1, status: 1 });

// Virtual for duration since application
applicationRecordSchema.virtual('daysSinceApplied').get(function() {
  if (!this.appliedAt) return null;
  const diffMs = Date.now() - this.appliedAt.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
});

// Virtual for is active application
applicationRecordSchema.virtual('isActive').get(function() {
  return ['pending', 'in-progress', 'submitted', 'interview'].includes(this.status);
});

// Method to add error log
applicationRecordSchema.methods.addError = function(step: string, error: string) {
  this.errorLog.push({
    step,
    error,
    timestamp: new Date(),
    resolved: false,
  });
  return this.save();
};

// Method to mark error as resolved
applicationRecordSchema.methods.resolveError = function(step: string) {
  const error = this.errorLog.find((e: any) => e.step === step && !e.resolved);
  if (error) {
    error.resolved = true;
    return this.save();
  }
  return Promise.resolve(this);
};

// Method to update status
applicationRecordSchema.methods.updateStatus = function(
  status: IApplicationRecord['status'],
  additionalData?: Partial<IApplicationRecord>
) {
  this.status = status;
  if (status === 'submitted' && !this.appliedAt) {
    this.appliedAt = new Date();
  }
  if (additionalData) {
    Object.assign(this, additionalData);
  }
  return this.save();
};

// Static method to check if already applied
applicationRecordSchema.statics.hasApplied = async function(userId: string, jobPostingId: Types.ObjectId) {
  const record = await this.findOne({ userId, jobPostingId });
  return !!record;
};

// Static method to get application statistics
applicationRecordSchema.statics.getStats = async function(userId: string) {
  const stats = await this.aggregate([
    { $match: { userId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const result = {
    total: 0,
    pending: 0,
    inProgress: 0,
    submitted: 0,
    failed: 0,
    rejected: 0,
    interview: 0,
    offer: 0,
    withdrawn: 0,
  };

  stats.forEach((s: any) => {
    result[s._id as keyof typeof result] = s.count;
    result.total += s.count;
  });

  return result;
};

// Static method to get applications needing intervention
applicationRecordSchema.statics.getNeedingIntervention = function(userId: string) {
  return this.find({
    userId,
    humanInterventionRequired: true,
    status: { $in: ['pending', 'in-progress', 'failed'] },
  }).populate('jobPostingId');
};

export const ApplicationRecord = mongoose.model<IApplicationRecord, IApplicationRecordModel>('ApplicationRecord', applicationRecordSchema);
export default ApplicationRecord;