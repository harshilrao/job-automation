import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IFilterCriteria {
  searchTerm?: string;
  locations: string[];
  jobTypes: string[];
  experienceLevels: string[];
  industries: string[];
  departments: string[];
  salaryMin?: number;
  salaryMax?: number;
  postedWithinHours?: number;
  remoteOnly: boolean;
  hybridOnly: boolean;
  sources: string[];
  excludedCompanies?: string[];
  excludedKeywords?: string[];
  requiredKeywords?: string[];
}

export interface IJobSearchFilter extends Document {
  userId: string;
  name: string;
  isDefault: boolean;
  filters: IFilterCriteria;
  createdAt: Date;
  updatedAt: Date;
}

export interface IJobSearchFilterModel extends Model<IJobSearchFilter> {
  getDefault(userId: string): mongoose.Query<IJobSearchFilter | null, IJobSearchFilter>;
  setDefault(userId: string, filterId: string): Promise<IJobSearchFilter | null>;
  getForUser(userId: string): mongoose.Query<IJobSearchFilter[], IJobSearchFilter>;
}

export interface IJobSearchFilterDocument extends IJobSearchFilter {
  buildQuery(): Record<string, any>;
}

const filterCriteriaSchema = new Schema<IFilterCriteria>({
  searchTerm: { type: String, trim: true },
  locations: [{ type: String, trim: true }],
  jobTypes: [{ type: String, trim: true }],
  experienceLevels: [{ type: String, trim: true }],
  industries: [{ type: String, trim: true }],
  departments: [{ type: String, trim: true }],
  salaryMin: { type: Number },
  salaryMax: { type: Number },
  postedWithinHours: { type: Number },
  remoteOnly: { type: Boolean, default: false },
  hybridOnly: { type: Boolean, default: false },
  sources: [{ type: String, trim: true }],
  excludedCompanies: [{ type: String, trim: true }],
  excludedKeywords: [{ type: String, trim: true }],
  requiredKeywords: [{ type: String, trim: true }],
}, { _id: false });

const jobSearchFilterSchema = new Schema<IJobSearchFilter>({
  userId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  isDefault: { type: Boolean, default: false, index: true },
  filters: { type: filterCriteriaSchema, required: true, default: () => ({}) },
}, {
  timestamps: true,
  collection: 'job_search_filters',
});

// Ensure only one default filter per user
jobSearchFilterSchema.index({ userId: 1, isDefault: 1 }, { unique: true, partialFilterExpression: { isDefault: true } });

// Static method to get default filter for user
jobSearchFilterSchema.statics.getDefault = function(userId: string) {
  return this.findOne({ userId, isDefault: true });
};

// Static method to set default filter
jobSearchFilterSchema.statics.setDefault = async function(userId: string, filterId: string) {
  // Remove default from all other filters
  await this.updateMany({ userId, isDefault: true }, { isDefault: false });
  // Set new default
  return this.findByIdAndUpdate(filterId, { isDefault: true }, { new: true });
};

// Static method to get all filters for user
jobSearchFilterSchema.statics.getForUser = function(userId: string) {
  return this.find({ userId }).sort({ isDefault: -1, updatedAt: -1 });
};

// Method to apply filters to job query
jobSearchFilterSchema.methods.buildQuery = function() {
  const query: any = { isActive: true };
  const f = this.filters;

  if (f.searchTerm) {
    query.$text = { $search: f.searchTerm };
  }

  if (f.locations?.length) {
    query['location.city'] = { $in: f.locations };
  }

  if (f.jobTypes?.length) {
    query.jobType = { $in: f.jobTypes };
  }

  if (f.experienceLevels?.length) {
    query.experienceLevel = { $in: f.experienceLevels };
  }

  if (f.industries?.length) {
    query.industry = { $in: f.industries };
  }

  if (f.departments?.length) {
    query.department = { $in: f.departments };
  }

  if (f.salaryMin) {
    query.salaryMax = { $gte: f.salaryMin };
  }

  if (f.salaryMax) {
    query.salaryMin = { $lte: f.salaryMax };
  }

  if (f.postedWithinHours) {
    const cutoff = new Date(Date.now() - f.postedWithinHours * 60 * 60 * 1000);
    query.postedDate = { $gte: cutoff };
  }

  if (f.remoteOnly) {
    query['location.remote'] = true;
  }

  if (f.hybridOnly) {
    query['location.hybrid'] = true;
  }

  if (f.sources?.length) {
    query.source = { $in: f.sources };
  }

  if (f.excludedCompanies?.length) {
    query.company = { $nin: f.excludedCompanies };
  }

  if (f.requiredKeywords?.length) {
    query.$and = f.requiredKeywords.map((kw: string) => ({
      $or: [
        { title: { $regex: kw, $options: 'i' } },
        { description: { $regex: kw, $options: 'i' } },
        { skills: { $regex: kw, $options: 'i' } },
      ],
    }));
  }

  if (f.excludedKeywords?.length) {
    query.$nor = f.excludedKeywords.map((kw: string) => ({
      $or: [
        { title: { $regex: kw, $options: 'i' } },
        { description: { $regex: kw, $options: 'i' } },
      ],
    }));
  }

  return query;
};

export const JobSearchFilter = mongoose.model<IJobSearchFilter, IJobSearchFilterModel>('JobSearchFilter', jobSearchFilterSchema);
export default JobSearchFilter;