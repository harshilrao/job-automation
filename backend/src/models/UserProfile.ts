import mongoose, { Document, Schema, Types } from 'mongoose';
import { encrypt, decrypt } from '../utils/helpers';
import { config } from '../config/env';

export interface IPersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: {
    street: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
  };
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
}

export interface ISkills {
  technical: string[];
  soft: string[];
  languages: string[];
  certifications: string[];
}

export interface IExperience {
  company: string;
  position: string;
  startDate: Date;
  endDate?: Date;
  current: boolean;
  description: string[];
  technologies: string[];
  location: string;
}

export interface IEducation {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: Date;
  endDate?: Date;
  gpa?: string;
  honors?: string[];
}

export interface IProject {
  name: string;
  description: string;
  technologies: string[];
  url?: string;
  githubUrl?: string;
}

export interface IPreferences {
  desiredRoles: string[];
  desiredLocations: string[];
  salaryMin: number;
  salaryMax: number;
  jobTypes: string[];
  industries: string[];
  workAuthorization: string;
}

export interface IUserProfile extends Document {
  userId: string;
  personalInfo: IPersonalInfo;
  professionalSummary: string;
  baseResumeText?: string;
  skills: ISkills;
  experience: IExperience[];
  education: IEducation[];
  projects: IProject[];
  preferences: IPreferences;
  encryptedFields: string[];
  createdAt: Date;
  updatedAt: Date;
}

const personalInfoSchema = new Schema<IPersonalInfo>({
  firstName: { type: String, trim: true, default: '' },
  lastName: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, lowercase: true, default: '' },
  phone: { type: String, trim: true, default: '' },
  address: {
    street: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    province: { type: String, trim: true, default: 'ON' },
    postalCode: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: 'Canada' },
  },
  linkedinUrl: { type: String, trim: true },
  githubUrl: { type: String, trim: true },
  portfolioUrl: { type: String, trim: true },
}, { _id: false });

const skillsSchema = new Schema<ISkills>({
  technical: [{ type: String, trim: true }],
  soft: [{ type: String, trim: true }],
  languages: [{ type: String, trim: true }],
  certifications: [{ type: String, trim: true }],
}, { _id: false });

const experienceSchema = new Schema<IExperience>({
  company: { type: String, required: true, trim: true },
  position: { type: String, required: true, trim: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date },
  current: { type: Boolean, default: false },
  description: [{ type: String, trim: true }],
  technologies: [{ type: String, trim: true }],
  location: { type: String, trim: true },
}, { _id: false });

const educationSchema = new Schema<IEducation>({
  institution: { type: String, required: true, trim: true },
  degree: { type: String, required: true, trim: true },
  fieldOfStudy: { type: String, required: true, trim: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date },
  gpa: { type: String, trim: true },
  honors: [{ type: String, trim: true }],
}, { _id: false });

const projectSchema = new Schema<IProject>({
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  technologies: [{ type: String, trim: true }],
  url: { type: String, trim: true },
  githubUrl: { type: String, trim: true },
}, { _id: false });

const preferencesSchema = new Schema<IPreferences>({
  desiredRoles: [{ type: String, trim: true }],
  desiredLocations: [{ type: String, trim: true }],
  salaryMin: { type: Number, default: 0 },
  salaryMax: { type: Number, default: 0 },
  jobTypes: [{ type: String, trim: true }],
  industries: [{ type: String, trim: true }],
  workAuthorization: { type: String, trim: true, default: 'Canadian Citizen' },
}, { _id: false });

const userProfileSchema = new Schema<IUserProfile>({
  userId: { type: String, required: true, unique: true, index: true },
  personalInfo: { type: personalInfoSchema, required: true },
  professionalSummary: { type: String, trim: true },
  skills: { type: skillsSchema, default: () => ({}) },
  experience: { type: [experienceSchema], default: [] },
  education: { type: [educationSchema], default: [] },
  projects: { type: [projectSchema], default: [] },
  preferences: { type: preferencesSchema, default: () => ({}) },
  encryptedFields: { type: [String], default: [] },
}, {
  timestamps: true,
  collection: 'user_profiles',
});

// Encrypt sensitive fields before saving
const sensitiveFields = ['personalInfo.email', 'personalInfo.phone', 'personalInfo.address'];

userProfileSchema.pre('save', function(next) {
  // Encrypt sensitive fields
  sensitiveFields.forEach(field => {
    const value = this.get(field);
    if (value && !this.encryptedFields.includes(field)) {
      this.set(field, encrypt(value));
      this.encryptedFields.push(field);
    }
  });
  next();
});

// Decrypt sensitive fields when retrieving
userProfileSchema.methods.getDecrypted = function(fieldPath: string): any {
  const field = this.get(fieldPath);
  if (field && this.encryptedFields.includes(fieldPath)) {
    return decrypt(field);
  }
  return field;
};

// Virtual for full name
userProfileSchema.virtual('fullName').get(function() {
  return `${this.personalInfo.firstName} ${this.personalInfo.lastName}`;
});

// Indexes
userProfileSchema.index({ 'personalInfo.email': 1 });
userProfileSchema.index({ 'preferences.desiredRoles': 1 });
userProfileSchema.index({ 'preferences.desiredLocations': 1 });

export const UserProfile = mongoose.model<IUserProfile>('UserProfile', userProfileSchema);
export default UserProfile;