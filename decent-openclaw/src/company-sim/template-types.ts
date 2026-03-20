import { z } from 'zod';
import type { CompanyParticipationConfig } from './types.ts';

const TemplateQuestionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string().min(1)),
]);

const TemplateParticipationSchema = z.object({
  mode: z.enum([
    'summary-first',
    'specialist',
    'mention-only',
    'silent-unless-routed',
    'proactive-on-owned-channel',
  ]),
  respondWhenMentioned: z.boolean().optional(),
  replyInThreadsOnly: z.boolean().optional(),
  respondToChannelTopics: z.array(z.string().min(1)).optional(),
}) satisfies z.ZodType<CompanyParticipationConfig>;

const TemplateRoleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  title: z.string().min(1).optional(),
  defaultAlias: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  managerRoleId: z.string().min(1).optional(),
  channels: z.array(z.string().min(1)).min(1).optional(),
  participation: TemplateParticipationSchema.optional(),
  defaultEnabled: z.boolean().optional().default(true),
});

const TemplateQuestionOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});

const TemplateQuestionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  type: z.enum(['text', 'textarea', 'select', 'multiselect', 'boolean', 'number']),
  required: z.boolean().optional().default(false),
  options: z.array(TemplateQuestionOptionSchema).optional(),
  default: TemplateQuestionValueSchema.optional(),
});

const TemplateDefaultsSchema = z.object({
  companyName: z.string().min(1),
  workspaceName: z.string().min(1),
  channels: z.array(z.string().min(1)).min(1),
  questionAnswers: z.record(TemplateQuestionValueSchema).optional().default({}),
});

const TemplatePolicyProfileSchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  roleParticipation: z.record(TemplateParticipationSchema.partial()).optional().default({}),
});

export const CompanyTemplateMetadataSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().min(1),
  roles: z.array(TemplateRoleSchema).min(1),
  questions: z.array(TemplateQuestionSchema).optional().default([]),
  defaults: TemplateDefaultsSchema,
  policyProfiles: z.record(TemplatePolicyProfileSchema).optional().default({}),
}).superRefine((value, ctx) => {
  const roleIds = new Set<string>();
  for (const role of value.roles) {
    if (roleIds.has(role.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate role id: ${role.id}`,
        path: ['roles'],
      });
    }
    roleIds.add(role.id);
  }

  const questionIds = new Set<string>();
  for (const question of value.questions) {
    if (questionIds.has(question.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate question id: ${question.id}`,
        path: ['questions'],
      });
    }
    questionIds.add(question.id);
  }
});

export type CompanyTemplateQuestionValue = z.infer<typeof TemplateQuestionValueSchema>;
export type CompanyTemplateParticipation = z.infer<typeof TemplateParticipationSchema>;
export type CompanyTemplateRoleDefinition = z.infer<typeof TemplateRoleSchema>;
export type CompanyTemplateQuestionOption = z.infer<typeof TemplateQuestionOptionSchema>;
export type CompanyTemplateQuestionDefinition = z.infer<typeof TemplateQuestionSchema>;
export type CompanyTemplateDefaults = z.infer<typeof TemplateDefaultsSchema>;
export type CompanyTemplatePolicyProfile = z.infer<typeof TemplatePolicyProfileSchema>;
export type CompanyTemplateMetadata = z.infer<typeof CompanyTemplateMetadataSchema>;
