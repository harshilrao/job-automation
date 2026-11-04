import { chromium, Browser, BrowserContext, Page, Locator, ElementHandle } from 'playwright';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { sleep, retry, encrypt, decrypt } from '../utils/helpers';
import { BROWSER_AUTOMATION, ATS_PLATFORMS } from '../utils/constants';
import * as fs from 'fs';
import * as path from 'path';

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'date' | 'url';
  required: boolean;
  value?: string;
  options?: string[]; // For select/radio
}

export interface ApplicationForm {
  url: string;
  platform: string;
  fields: FormField[];
  steps: number;
  currentStep: number;
  hasCaptcha: boolean;
  captchaType?: 'recaptcha' | 'hcaptcha' | 'cloudflare' | 'custom';
}

export interface ApplicationResult {
  success: boolean;
  applicationId?: string;
  confirmationNumber?: string;
  confirmationEmail?: string;
  screenshots: string[];
  errorLog: Array<{
    step: string;
    field?: string;
    error: string;
    timestamp: Date;
    resolved: boolean;
  }>;
  humanInterventionRequired: boolean;
  interventionReason?: string;
}

export interface UserCredentials {
  email: string;
  password: string;
  linkedinEmail?: string;
  linkedinPassword?: string;
  indeedEmail?: string;
  indeedPassword?: string;
}

export class BrowserAutomationService {
  private browser: BrowserContext | null = null;
  private page: Page | null = null;
  private userDataDir: string;
  private credentials: UserCredentials | null = null;
  private screenshotsDir: string;

  constructor() {
    this.userDataDir = config.playwright.userDataDir;
    this.screenshotsDir = path.join(process.cwd(), 'screenshots');

    // Ensure directories exist
    if (!fs.existsSync(this.userDataDir)) {
      fs.mkdirSync(this.userDataDir, { recursive: true });
    }
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }
  }

  /**
   * Initialize browser with persistent context
   */
  async initialize(credentials?: UserCredentials): Promise<void> {
    if (this.browser) {
      logger.warn('Browser already initialized');
      return;
    }

    this.credentials = credentials || null;

    try {
      this.browser = await chromium.launchPersistentContext(this.userDataDir, {
        headless: config.playwright.headless,
        viewport: { width: 1280, height: 720 },
        userAgent: BROWSER_AUTOMATION.USER_AGENT,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
        permissions: ['clipboard-read', 'clipboard-write'],
      });

      this.page = await this.browser.newPage();

      // Set timeouts
      this.page.setDefaultTimeout(BROWSER_AUTOMATION.TIMEOUT);
      this.page.setDefaultNavigationTimeout(BROWSER_AUTOMATION.NAVIGATION_TIMEOUT);

      // Block unnecessary resources for speed
      await this.page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'font', 'media'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      logger.info('Browser initialized successfully');
    } catch (error: any) {
      logger.error('Failed to initialize browser:', error);
      throw error;
    }
  }

  /**
   * Navigate to application URL and analyze form
   */
  async analyzeApplicationForm(url: string): Promise<ApplicationForm> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    logger.info('Analyzing application form', { url });

    await this.page.goto(url, { waitUntil: 'networkidle' });
    await sleep(2000);

    // Detect platform
    const platform = this.detectPlatform(url);

    // Check for CAPTCHA
    const hasCaptcha = await this.detectCaptcha();
    const captchaType = hasCaptcha ? await this.identifyCaptchaType() : undefined;

    // Analyze form fields
    const fields = await this.extractFormFields();

    // Determine number of steps
    const steps = await this.countSteps();

    const form: ApplicationForm = {
      url,
      platform,
      fields,
      steps,
      currentStep: 1,
      hasCaptcha,
      captchaType,
    };

    logger.info('Form analysis complete', {
      platform,
      fieldCount: fields.length,
      steps,
      hasCaptcha,
    });

    return form;
  }

  /**
   * Fill and submit application form
   */
  async fillAndSubmitApplication(
    form: ApplicationForm,
    userProfile: any,
    resumePath?: string,
    coverLetterPath?: string
  ): Promise<ApplicationResult> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    const result: ApplicationResult = {
      success: false,
      screenshots: [],
      errorLog: [],
      humanInterventionRequired: false,
    };

    try {
      // Take initial screenshot
      const initialScreenshot = await this.takeScreenshot('initial');
      result.screenshots.push(initialScreenshot);

      // Handle multi-step forms
      for (let step = 1; step <= form.steps; step++) {
        form.currentStep = step;

        logger.info(`Processing step ${step}/${form.steps}`);

        // Wait for form to load
        await this.waitForFormReady();

        // Check for CAPTCHA on each step
        if (await this.detectCaptcha()) {
          result.humanInterventionRequired = true;
          result.interventionReason = 'CAPTCHA detected';
          const captchaScreenshot = await this.takeScreenshot(`captcha-step-${step}`);
          result.screenshots.push(captchaScreenshot);
          logger.warn('CAPTCHA detected, human intervention required');
          break;
        }

        // Fill form fields for current step
        const stepFields = form.fields.filter(f => this.isFieldVisible(f));
        await this.fillFormFields(stepFields, userProfile, resumePath, coverLetterPath);

        // Take screenshot after filling
        const filledScreenshot = await this.takeScreenshot(`filled-step-${step}`);
        result.screenshots.push(filledScreenshot);

        // Click next/submit button
        if (step < form.steps) {
          const clicked = await this.clickNextButton();
          if (!clicked) {
            result.errorLog.push({
              step: `step-${step}`,
              error: 'Could not find next button',
              timestamp: new Date(),
              resolved: false,
            });
            result.humanInterventionRequired = true;
            result.interventionReason = 'Navigation issue';
            break;
          }
          await sleep(2000);
        } else {
          // Final submission
          const submitted = await this.clickSubmitButton();
          if (submitted) {
            await sleep(3000);
            result.success = true;
            result.confirmationNumber = await this.extractConfirmationNumber();
            result.confirmationEmail = await this.extractConfirmationEmail();
          } else {
            result.errorLog.push({
              step: 'submission',
              error: 'Could not find submit button',
              timestamp: new Date(),
              resolved: false,
            });
            result.humanInterventionRequired = true;
            result.interventionReason = 'Submit button not found';
          }
        }
      }

      // Final screenshot
      const finalScreenshot = await this.takeScreenshot('final');
      result.screenshots.push(finalScreenshot);

    } catch (error: any) {
      logger.error('Application filling failed:', error);
      result.errorLog.push({
        step: 'general',
        error: error.message,
        timestamp: new Date(),
        resolved: false,
      });
      result.humanInterventionRequired = true;
      result.interventionReason = `Error: ${error.message}`;
    }

    return result;
  }

  /**
   * Detect platform from URL
   */
  private detectPlatform(url: string): string {
    const lowerUrl = url.toLowerCase();

    if (lowerUrl.includes('greenhouse.io') || lowerUrl.includes('boards.greenhouse.io')) {
      return 'greenhouse';
    }
    if (lowerUrl.includes('lever.co') || lowerUrl.includes('jobs.lever.co')) {
      return 'lever';
    }
    if (lowerUrl.includes('workday') || lowerUrl.includes('myworkdayjobs')) {
      return 'workday';
    }
    if (lowerUrl.includes('icims.com')) {
      return 'icims';
    }
    if (lowerUrl.includes('smartrecruiters.com')) {
      return 'smartrecruiters';
    }
    if (lowerUrl.includes('bamboohr.com')) {
      return 'bamboohr';
    }
    if (lowerUrl.includes('taleo.net')) {
      return 'taleo';
    }
    if (lowerUrl.includes('jobvite.com')) {
      return 'jobvite';
    }
    if (lowerUrl.includes('oracle.com') || lowerUrl.includes('taleo')) {
      return 'oracle';
    }
    if (lowerUrl.includes('sap.com') || lowerUrl.includes('successfactors')) {
      return 'sap';
    }
    if (lowerUrl.includes('linkedin.com/jobs/apply') || lowerUrl.includes('linkedin.com/easy-apply')) {
      return 'linkedin-easy';
    }
    if (lowerUrl.includes('indeed.com/apply')) {
      return 'indeed-apply';
    }

    return 'custom';
  }

  /**
   * Detect CAPTCHA on page
   */
  private async detectCaptcha(): Promise<boolean> {
    if (!this.page) return false;

    const captchaSelectors = [
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      '.g-recaptcha',
      '.h-captcha',
      '#cf-challenge-container',
      '.cloudflare-challenge',
      '[data-captcha]',
      '.captcha-container',
    ];

    for (const selector of captchaSelectors) {
      const element = await this.page.locator(selector).first();
      if (await element.count() > 0) {
        return true;
      }
    }

    // Check for CAPTCHA text
    const bodyText = await this.page.locator('body').textContent();
    if (bodyText && (
      bodyText.toLowerCase().includes('captcha') ||
      bodyText.toLowerCase().includes('verify you are human') ||
      bodyText.toLowerCase().includes('prove you are not a robot')
    )) {
      return true;
    }

    return false;
  }

  /**
   * Identify CAPTCHA type
   */
  private async identifyCaptchaType(): Promise<'recaptcha' | 'hcaptcha' | 'cloudflare' | 'custom'> {
    if (!this.page) return 'custom';

    if (await this.page.locator('iframe[src*="recaptcha"], .g-recaptcha').first().count() > 0) {
      return 'recaptcha';
    }
    if (await this.page.locator('iframe[src*="hcaptcha"], .h-captcha').first().count() > 0) {
      return 'hcaptcha';
    }
    if (await this.page.locator('#cf-challenge-container, .cloudflare-challenge').first().count() > 0) {
      return 'cloudflare';
    }
    return 'custom';
  }

  /**
   * Extract all form fields from current page
   */
  private async extractFormFields(): Promise<FormField[]> {
    if (!this.page) return [];

    const fields: FormField[] = [];

    // Get all input, select, textarea elements
    const elements = await this.page.locator('input, select, textarea').all();

    for (const element of elements) {
      try {
        const field = await this.extractFieldInfo(element);
        if (field && !this.shouldSkipField(field)) {
          fields.push(field);
        }
      } catch (error) {
        // Skip problematic elements
      }
    }

    return fields;
  }

  /**
   * Extract information from a form field element
   */
  private async extractFieldInfo(element: Locator): Promise<FormField | null> {
    if (!this.page) return null;

    const tagName = await element.evaluate(el => el.tagName.toLowerCase());
    const type = await element.getAttribute('type') || 'text';
    const name = await element.getAttribute('name') || '';
    const id = await element.getAttribute('id') || '';
    const placeholder = await element.getAttribute('placeholder') || '';
    const required = await element.getAttribute('required') !== null;
    const disabled = await element.getAttribute('disabled') !== null;

    if (disabled) return null;

    // Find label
    let label = '';
    if (id) {
      const labelEl = await this.page.locator(`label[for="${id}"]`).first();
      if (await labelEl.count() > 0) {
        label = await labelEl.textContent() || '';
      }
    }
    if (!label) {
      // Try parent label
      label = await element.evaluate(el => {
        const parentLabel = el.closest('label');
        return parentLabel?.textContent || '';
      });
    }
    if (!label) {
      // Try aria-label
      label = await element.getAttribute('aria-label') || '';
    }
    if (!label) {
      label = placeholder;
    }
    if (!label && name) {
      label = name.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    // Get options for select
    let options: string[] | undefined;
    if (tagName === 'select') {
      const optionElements = await element.locator('option').all();
      options = [];
      for (const opt of optionElements) {
        const value = await opt.getAttribute('value');
        const text = await opt.textContent();
        if (value && text) {
          options.push(`${value}:${text.trim()}`);
        }
      }
    }

    return {
      name: name || id,
      label: label.trim(),
      type: this.mapInputType(tagName, type),
      required,
      options,
    };
  }

  /**
   * Map HTML input type to our field type
   */
  private mapInputType(tagName: string, type: string): FormField['type'] {
    if (tagName === 'select') return 'select';
    if (tagName === 'textarea') return 'textarea';
    switch (type) {
      case 'email': return 'email';
      case 'tel': return 'tel';
      case 'radio': return 'radio';
      case 'checkbox': return 'checkbox';
      case 'file': return 'file';
      case 'date': return 'date';
      case 'url': return 'url';
      default: return 'text';
    }
  }

  /**
   * Check if field should be skipped
   */
  private shouldSkipField(field: FormField): boolean {
    const skipPatterns = [
      'captcha', 'recaptcha', 'h-captcha', 'token', 'csrf', '_token',
      'submit', 'button', 'hidden', 'honeypot', 'utm_', 'referrer',
      'g-recaptcha-response', 'h-captcha-response',
    ];

    const fieldId = `${field.name} ${field.label}`.toLowerCase();
    return skipPatterns.some(p => fieldId.includes(p));
  }

  /**
   * Check if field is visible on current step
   */
  private isFieldVisible(field: FormField): boolean {
    // In a real implementation, this would check visibility
    // For now, return true for all fields
    return true;
  }

  /**
   * Fill form fields with user data
   */
  private async fillFormFields(
    fields: FormField[],
    userProfile: any,
    resumePath?: string,
    coverLetterPath?: string
  ): Promise<void> {
    if (!this.page) return;

    for (const field of fields) {
      try {
        const value = this.getFieldValue(field, userProfile, resumePath, coverLetterPath);
        if (value === undefined || value === null || value === '') continue;

        await this.fillField(field, value);
        await sleep(100); // Small delay between fields
      } catch (error: any) {
        logger.warn(`Failed to fill field ${field.name}:`, error.message);
      }
    }
  }

  /**
   * Get value for a field based on user profile
   */
  private getFieldValue(
    field: FormField,
    userProfile: any,
    resumePath?: string,
    coverLetterPath?: string
  ): string | undefined {
    const label = field.label.toLowerCase();
    const name = field.name.toLowerCase();

    // Personal info
    if (this.matchField(label, name, ['first name', 'firstname', 'given name'])) {
      return userProfile.personalInfo?.firstName;
    }
    if (this.matchField(label, name, ['last name', 'lastname', 'surname', 'family name'])) {
      return userProfile.personalInfo?.lastName;
    }
    if (this.matchField(label, name, ['email', 'e-mail', 'mail'])) {
      return userProfile.personalInfo?.email;
    }
    if (this.matchField(label, name, ['phone', 'telephone', 'mobile', 'cell'])) {
      return userProfile.personalInfo?.phone;
    }
    if (this.matchField(label, name, ['address', 'street', 'line 1'])) {
      return userProfile.personalInfo?.address?.street;
    }
    if (this.matchField(label, name, ['city'])) {
      return userProfile.personalInfo?.address?.city;
    }
    if (this.matchField(label, name, ['state', 'province', 'region'])) {
      return userProfile.personalInfo?.address?.province;
    }
    if (this.matchField(label, name, ['zip', 'postal', 'postcode'])) {
      return userProfile.personalInfo?.address?.postalCode;
    }
    if (this.matchField(label, name, ['country'])) {
      return userProfile.personalInfo?.address?.country;
    }
    if (this.matchField(label, name, ['linkedin', 'linked in'])) {
      return userProfile.personalInfo?.linkedinUrl;
    }
    if (this.matchField(label, name, ['github', 'git hub'])) {
      return userProfile.personalInfo?.githubUrl;
    }
    if (this.matchField(label, name, ['portfolio', 'website', 'url', 'personal site'])) {
      return userProfile.personalInfo?.portfolioUrl;
    }

    // Resume/Cover Letter upload
    if (this.matchField(label, name, ['resume', 'cv', 'curriculum vitae']) && field.type === 'file') {
      return resumePath;
    }
    if (this.matchField(label, name, ['cover letter', 'coverletter', 'motivation']) && field.type === 'file') {
      return coverLetterPath;
    }

    // Professional summary
    if (this.matchField(label, name, ['summary', 'objective', 'profile', 'about'])) {
      return userProfile.professionalSummary;
    }

    // Skills
    if (this.matchField(label, name, ['skills', 'technologies', 'tech stack', 'expertise'])) {
      const techSkills = userProfile.skills?.technical?.join(', ') || '';
      const softSkills = userProfile.skills?.soft?.join(', ') || '';
      return `${techSkills}${softSkills ? ', ' + softSkills : ''}`;
    }

    // Work authorization
    if (this.matchField(label, name, ['authorization', 'visa', 'work permit', 'citizenship', 'eligible'])) {
      return userProfile.preferences?.workAuthorization || 'Canadian Citizen';
    }

    // Salary expectations
    if (this.matchField(label, name, ['salary', 'compensation', 'expected', 'desired pay', 'rate'])) {
      const min = userProfile.preferences?.salaryMin || 0;
      const max = userProfile.preferences?.salaryMax || 0;
      if (min && max) return `$${min} - $${max}`;
      if (min) return `$${min}+`;
      return '';
    }

    // Notice period
    if (this.matchField(label, name, ['notice', 'availability', 'start date', 'available'])) {
      return '2 weeks';
    }

    // Referral
    if (this.matchField(label, name, ['referral', 'referred', 'how did you hear'])) {
      return 'Online job board';
    }

    // Custom questions - would need AI to answer
    return undefined;
  }

  /**
   * Match field against patterns
   */
  private matchField(label: string, name: string, patterns: string[]): boolean {
    const combined = `${label} ${name}`.toLowerCase();
    return patterns.some(p => combined.includes(p.toLowerCase()));
  }

  /**
   * Fill a single field
   */
  private async fillField(field: FormField, value: string): Promise<void> {
    if (!this.page) return;

    const selector = `[name="${field.name}"], #${field.name}`;
    const element = await this.page.locator(selector).first();

    if (await element.count() === 0) {
      // Try by label
      const labelSelector = `label:has-text("${field.label}") + input, label:has-text("${field.label}") + select, label:has-text("${field.label}") + textarea`;
      const labelElement = await this.page.locator(labelSelector).first();
      if (await labelElement.count() > 0) {
        await this.fillElement(labelElement, field, value);
        return;
      }
      logger.warn(`Field not found: ${field.name} (${field.label})`);
      return;
    }

    await this.fillElement(element, field, value);
  }

  /**
   * Fill element based on type
   */
  private async fillElement(element: Locator, field: FormField, value: string): Promise<void> {
    switch (field.type) {
      case 'select':
        await element.selectOption({ label: value }).catch(async () => {
          // Try by value
          await element.selectOption({ value }).catch(() => {
            // Try first option containing value (case insensitive)
            return element.selectOption({ label: value });
          });
        });
        break;

      case 'radio':
        await element.check();
        break;

      case 'checkbox':
        if (value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'yes') {
          await element.check();
        } else {
          await element.uncheck();
        }
        break;

      case 'file':
        await element.setInputFiles(value);
        break;

      case 'date':
        await element.fill(value);
        break;

      default:
        await element.fill(value);
        break;
    }
  }

  /**
   * Wait for form to be ready
   */
  private async waitForFormReady(): Promise<void> {
    if (!this.page) return;

    await this.page.waitForLoadState('networkidle');
    await sleep(1000);
  }

  /**
   * Count form steps
   */
  private async countSteps(): Promise<number> {
    if (!this.page) return 1;

    // Look for step indicators
    const stepSelectors = [
      '[data-step]',
      '.step-indicator',
      '.progress-step',
      '.wizard-step',
      'nav[aria-label*="step"]',
      '.stepper li',
    ];

    for (const selector of stepSelectors) {
      const elements = await this.page.locator(selector).all();
      if (elements.length > 1) {
        return elements.length;
      }
    }

    // Check for next/continue buttons
    const nextButtons = await this.page.locator('button:has-text("Next"), button:has-text("Continue"), a:has-text("Next"), a:has-text("Continue")').all();
    if (nextButtons.length > 0) {
      return 2; // At least 2 steps
    }

    return 1;
  }

  /**
   * Click next/continue button
   */
  private async clickNextButton(): Promise<boolean> {
    if (!this.page) return false;

    const nextSelectors = [
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'button:has-text("Proceed")',
      'a:has-text("Next")',
      'a:has-text("Continue")',
      '[data-action="next"]',
      '.next-button',
      '.continue-button',
    ];

    for (const selector of nextSelectors) {
      const button = await this.page.locator(selector).first();
      if (await button.count() > 0) {
        await button.click();
        return true;
      }
    }

    return false;
  }

  /**
   * Click submit button
   */
  private async clickSubmitButton(): Promise<boolean> {
    if (!this.page) return false;

    const submitSelectors = [
      'button:has-text("Submit")',
      'button:has-text("Apply")',
      'button:has-text("Send")',
      'button[type="submit"]',
      'input[type="submit"]',
      '[data-action="submit"]',
      '.submit-button',
      '.apply-button',
    ];

    for (const selector of submitSelectors) {
      const button = await this.page.locator(selector).first();
      if (await button.count() > 0) {
        // Check if disabled
        const disabled = await button.getAttribute('disabled');
        if (disabled) continue;

        await button.click();
        return true;
      }
    }

    return false;
  }

  /**
   * Extract confirmation number from page
   */
  private async extractConfirmationNumber(): Promise<string | undefined> {
    if (!this.page) return undefined;

    const text = await this.page.locator('body').textContent();
    if (!text) return undefined;

    // Look for confirmation patterns
    const patterns = [
      /confirmation\s*(?:number|#|id)[:#\s]+([A-Z0-9-]+)/i,
      /application\s*(?:number|#|id)[:#\s]+([A-Z0-9-]+)/i,
      /reference\s*(?:number|#|id)[:#\s]+([A-Z0-9-]+)/i,
      /tracking\s*(?:number|#|id)[:#\s]+([A-Z0-9-]+)/i,
      /your\s+application\s+(?:has been\s+)?(?:received|submitted)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return undefined;
  }

  /**
   * Extract confirmation email from page
   */
  private async extractConfirmationEmail(): Promise<string | undefined> {
    if (!this.page) return undefined;

    const text = await this.page.locator('body').textContent();
    if (!text) return undefined;

    const emailMatch = text.match(/confirmation\s+(?:email|sent to)[:]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    return emailMatch ? emailMatch[1] : undefined;
  }

  /**
   * Take screenshot
   */
  private async takeScreenshot(prefix: string): Promise<string> {
    if (!this.page) return '';

    const filename = `${prefix}-${Date.now()}.png`;
    const filepath = path.join(this.screenshotsDir, filename);

    await this.page.screenshot({
      path: filepath,
      fullPage: true,
      quality: BROWSER_AUTOMATION.SCREENSHOT_QUALITY,
    });

    return filepath;
  }

  /**
   * Handle LinkedIn Easy Apply
   */
  async handleLinkedInEasyApply(url: string, userProfile: any, resumePath?: string): Promise<ApplicationResult> {
    // LinkedIn Easy Apply has specific flow
    return this.fillAndSubmitApplication(
      await this.analyzeApplicationForm(url),
      userProfile,
      resumePath
    );
  }

  /**
   * Handle Indeed Apply
   */
  async handleIndeedApply(url: string, userProfile: any, resumePath?: string): Promise<ApplicationResult> {
    // Indeed Apply has specific flow
    return this.fillAndSubmitApplication(
      await this.analyzeApplicationForm(url),
      userProfile,
      resumePath
    );
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      logger.info('Browser closed');
    }
  }

  /**
   * Get current page for debugging
   */
  getPage(): Page | null {
    return this.page;
  }
}

export const browserAutomationService = new BrowserAutomationService();
export default browserAutomationService;