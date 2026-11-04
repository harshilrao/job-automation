import mongoose, { Document, Schema, Types, Model } from 'mongoose';

export interface ILocation {
  city: string;
  province: string;
  country: string;
  remote: boolean;
  hybrid: boolean;
}

export interface IJobPosting extends Document {
  externalId: string;
  source: string;
  sourceUrl: string;
  title: string;
  company: string;
  companyLogo?: string;
  location: ILocation;
  description: string;
  descriptionHtml?: string;
  requirements: string[];
  responsibilities: string[];
  skills: string[];
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency: string;
  jobType: string;
  experienceLevel: string;
  industry?: string;
  department?: string;
  postedDate: Date;
  expiryDate?: Date;
  applicationUrl: string;
  applicationType: string;
  atsPlatform?: string;
  benefits?: string[];
  perks?: string[];
  scrapedAt: Date;
  lastUpdated: Date;
  isActive: boolean;
  metadata: Record<string, any>;
  // Computed fields
  matchScore?: number;
  matchedSkills?: string[];
  missingSkills?: string[];
}

export interface IJobPostingModel extends Model<IJobPosting> {
  findByFilters(filters: any): mongoose.Query<IJobPosting[], IJobPosting>;
}

const locationSchema = new Schema<ILocation>({
  city: { type: String, required: true, trim: true, index: true },
  province: { type: String, required: true, trim: true, index: true },
  country: { type: String, required: true, trim: true, default: 'Canada' },
  remote: { type: Boolean, default: false, index: true },
  hybrid: { type: Boolean, default: false, index: true },
}, { _id: false });

const jobPostingSchema = new Schema<IJobPosting>({
  externalId: { type: String, required: true, trim: true, index: true },
  source: { type: String, required: true, trim: true, index: true },
  sourceUrl: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true, index: 'text' },
  company: { type: String, required: true, trim: true, index: true },
  companyLogo: { type: String, trim: true },
  location: { type: locationSchema, required: true, index: true },
  description: { type: String, required: true, index: 'text' },
  descriptionHtml: { type: String },
  requirements: [{ type: String, trim: true }],
  responsibilities: [{ type: String, trim: true }],
  skills: [{ type: String, trim: true, index: true }],
  salaryMin: { type: Number, index: true },
  salaryMax: { type: Number, index: true },
  salaryCurrency: { type: String, default: 'CAD' },
  jobType: { type: String, required: true, trim: true, index: true },
  experienceLevel: { type: String, required: true, trim: true, index: true },
  industry: { type: String, trim: true, index: true },
  department: { type: String, trim: true, index: true },
  postedDate: { type: Date, required: true, index: true },
  expiryDate: { type: Date, index: true },
  applicationUrl: { type: String, required: true, trim: true },
  applicationType: { type: String, required: true, trim: true },
  atsPlatform: { type: String, trim: true, index: true },
  benefits: [{ type: String, trim: true }],
  perks: [{ type: String, trim: true }],
  scrapedAt: { type: Date, required: true, default: Date.now, index: true },
  lastUpdated: { type: Date, required: true, default: Date.now },
  isActive: { type: Boolean, default: true, index: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  collection: 'job_postings',
});

// Compound indexes for common queries
jobPostingSchema.index({ source: 1, externalId: 1 }, { unique: true });
jobPostingSchema.index({ isActive: 1, postedDate: -1 });
jobPostingSchema.index({ 'location.city': 1, isActive: 1 });
jobPostingSchema.index({ skills: 1, isActive: 1 });
jobPostingSchema.index({ company: 1, isActive: 1 });
jobPostingSchema.index({ title: 'text', description: 'text', company: 'text' });

// Virtual for salary range display
jobPostingSchema.virtual('salaryRange').get(function() {
  if (this.salaryMin && this.salaryMax) {
    return `${this.salaryCurrency} ${this.salaryMin.toLocaleString()} - ${this.salaryMax.toLocaleString()}`;
  } else if (this.salaryMin) {
    return `${this.salaryCurrency} ${this.salaryMin.toLocaleString()}+`;
  } else if (this.salaryMax) {
    return `Up to ${this.salaryCurrency} ${this.salaryMax.toLocaleString()}`;
  }
  return 'Not specified';
});

// Virtual for location display
jobPostingSchema.virtual('locationDisplay').get(function() {
  const parts = [this.location.city, this.location.province];
  if (this.location.remote) parts.push('Remote');
  if (this.location.hybrid) parts.push('Hybrid');
  return parts.join(', ');
});

// Method to check if job is expired
jobPostingSchema.methods.isExpired = function(): boolean {
  if (!this.expiryDate) return false;
  return new Date() > this.expiryDate;
};

// Method to calculate match score against user profile
jobPostingSchema.methods.calculateMatchScore = function(userSkills: string[]): number {
  if (!userSkills.length || !this.skills.length) return 0;

  const userSkillSet = new Set(userSkills.map((s: string) => s.toLowerCase()));
  const jobSkillSet = new Set(this.skills.map((s: string) => s.toLowerCase()));

  let matches = 0;
  for (const skill of jobSkillSet) {
    if (userSkillSet.has(skill as string)) {
      matches++;
    }
  }

  return Math.round((matches / jobSkillSet.size) * 100);
};

// Static method to find jobs by filters
jobPostingSchema.statics.findByFilters = function(filters: any) {
  const query: any = { isActive: true };

  if (filters.searchTerm) {
    query.$text = { $search: filters.searchTerm };
  }

  if (filters.cities?.length) {
    query['location.city'] = { $in: filters.cities };
  }

  if (filters.jobTypes?.length) {
    query.jobType = { $in: filters.jobTypes };
  }

  if (filters.experienceLevels?.length) {
    query.experienceLevel = { $in: filters.experienceLevels };
  }

  if (filters.industries?.length) {
    query.industry = { $in: filters.industries };
  }

  if (filters.departments?.length) {
    query.department = { $in: filters.departments };
  }

  if (filters.salaryMin) {
    query.salaryMax = { $gte: filters.salaryMin };
  }

  if (filters.salaryMax) {
    query.salaryMin = { $lte: filters.salaryMax };
  }

  if (filters.postedWithinHours) {
    const cutoff = new Date(Date.now() - filters.postedWithinHours * 60 * 60 * 1000);
    query.postedDate = { $gte: cutoff };
  }

  if (filters.remoteOnly) {
    query['location.remote'] = true;
  }

  if (filters.hybridOnly) {
    query['location.hybrid'] = true;
  }

  if (filters.sources?.length) {
    query.source = { $in: filters.sources };
  }

  if (filters.excludedCompanies?.length) {
    query.company = { $nin: filters.excludedCompanies };
  }

  if (filters.requiredKeywords?.length) {
    query.$and = filters.requiredKeywords.map((kw: string) => ({
      $or: [
        { title: { $regex: kw, $options: 'i' } },
        { description: { $regex: kw, $options: 'i' } },
        { skills: { $regex: kw, $options: 'i' } },
      ],
    }));
  }

  if (filters.excludedKeywords?.length) {
    query.$nor = filters.excludedKeywords.map((kw: string) => ({
      $or: [
        { title: { $regex: kw, $options: 'i' } },
        { description: { $regex: kw, $options: 'i' } },
      ],
    }));
  }

  return this.find(query);
};

export const JobPosting = mongoose.model<IJobPosting, IJobPostingModel>('JobPosting', jobPostingSchema);
export default JobPosting;