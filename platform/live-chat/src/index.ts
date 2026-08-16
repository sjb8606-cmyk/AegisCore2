import { parseUserId } from '@platform/utils';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export const MessageSchema = z.object({
  conversation_id: z.string().uuid(),
  message: z.string().min(1),
  attachments: z.array(z.string().url()).optional(),
});

export const ConversationSchema = z.object({
  user_id: z.string().uuid().optional(),
  priority: z.number().int().min(1).max(5).default(1),
});

export const LiveChatConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    basicChat: z.boolean().default(true),
    realTimeMessaging: z.boolean().default(true),
    conversationHistory: z.boolean().default(true),
    agentRouting: z.boolean().default(true),
    chatWidget: z.boolean().default(true),
    fileAttachments: z.boolean().default(true),
    offlineMessages: z.boolean().default(true),
    typingIndicators: z.boolean().default(true),
    aiAssistSuggestions: z.boolean().default(false),
    conversationTagging: z.boolean().default(true),
    escalationRules: z.boolean().default(false),
    slaTracking: z.boolean().default(false),
    multiChannelSync: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
  }),
  limits: z.object({
    messagesPerSecond: z.number().default(5),
    activeConversations: z.number().default(100),
    agentsPerTenant: z.number().default(10),
  }),
});

export type LiveChatConfig = z.infer<typeof LiveChatConfigSchema>;

let cachedConfig: LiveChatConfig | null = null;

export function loadConfig(): LiveChatConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/live_chat.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = LiveChatConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = LiveChatConfigSchema.parse({
    enabled: true,
    tiers: {
      basicChat: true,
      realTimeMessaging: true,
      conversationHistory: true,
      agentRouting: true,
      chatWidget: true,
      fileAttachments: true,
      offlineMessages: true,
      typingIndicators: true,
      aiAssistSuggestions: false,
      conversationTagging: true,
      escalationRules: false,
      slaTracking: false,
      multiChannelSync: false,
      auditTrail: true,
    },
    limits: {
      messagesPerSecond: 5,
      activeConversations: 100,
      agentsPerTenant: 10,
    }
  });
  return cachedConfig;
}

export class LiveChatService {
  static async createConversation(tenantId: string, data: any, userId?: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Live chat is globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.basicChat) {
      throw new AppError('Live chat features are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const conversation = ConversationSchema.parse(data);
    const cleanUserId = parseUserId(userId || conversation.user_id);

    const sql = `
      INSERT INTO chat_conversations (tenant_id, user_id, priority, status)
      VALUES ($1::uuid, $2::uuid, $3, 'open') 
      RETURNING *
    `;
    const params = [tenantId, cleanUserId, conversation.priority];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to initialize conversation', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async sendMessage(tenantId: string, data: any, senderId: string, senderType: 'user' | 'agent') {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Live chat is globally disabled', ErrorCode.FORBIDDEN);
    }

    const message = MessageSchema.parse(data);
    const cleanSenderId = parseUserId(senderId);

    const sql = `
      INSERT INTO chat_messages (tenant_id, conversation_id, sender_id, sender_type, message, attachments)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb) 
      RETURNING *
    `;
    const params = [
      tenantId, 
      message.conversation_id, 
      cleanSenderId, 
      senderType, 
      message.message, 
      JSON.stringify(message.attachments || [])
    ];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to send message', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async fetchConversations(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, user_id, assigned_agent, status, priority, tags, created_at, updated_at 
      FROM chat_conversations 
      WHERE tenant_id = $1::uuid
      ORDER BY updated_at DESC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
