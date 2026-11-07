// Keep repairs and guards in SQLite so all writers share the same constraints.
export const recoverMissingConversationsSql = `
  insert into conversations (id, title, createdAt, updatedAt, messageCount, isPinned)
  select c.conversationId, '恢复的历史对话 ' || c.conversationId,
         min(c.createdAt), max(c.createdAt), count(*), 0
  from chats c
  where c.conversationId is not null
    and not exists (select 1 from conversations p where p.id = c.conversationId)
    and not exists (select 1 from conversation_sync_tombstones t where t.entityType = 'conversation')
    and not exists (
      select 1 from chats m join conversation_sync_tombstones t
        on t.entityType = 'message' and t.syncId = m.syncId
      where m.conversationId = c.conversationId
    )
  group by c.conversationId
`

export const guardMessageInsertSql = `
  create trigger if not exists sixu_chat_parent_insert before insert on chats
  when NEW.conversationId is not null
    and not exists (select 1 from conversations where id = NEW.conversationId)
  begin select raise(ABORT, 'Cannot save message: conversation is missing'); end
`

export const guardMessageMoveSql = `
  create trigger if not exists sixu_chat_parent_update before update of conversationId on chats
  when NEW.conversationId is not null
    and not exists (select 1 from conversations where id = NEW.conversationId)
  begin select raise(ABORT, 'Cannot move message: conversation is missing'); end
`

export const guardConversationDeleteSql = `
  create trigger if not exists sixu_conversation_delete before delete on conversations
  when exists (select 1 from chats where conversationId = OLD.id)
  begin select raise(ABORT, 'Cannot remove conversation while messages remain'); end
`
