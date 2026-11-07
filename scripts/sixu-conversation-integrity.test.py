import pathlib
import re
import sqlite3
import unittest

source = (pathlib.Path(__file__).resolve().parents[1] / 'src/db/conversation-integrity.ts').read_text(encoding='utf-8')
sql = dict(re.findall(r'export const (\w+) = `([^`]+)`', source))


class ConversationIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript('''
            create table conversations(id integer primary key, title text, createdAt integer,
                updatedAt integer, messageCount integer, isPinned integer);
            create table chats(id integer primary key, conversationId integer, content text,
                createdAt integer, syncId text);
            create table conversation_sync_tombstones(entityType text, syncId text);
        ''')

    def tearDown(self):
        self.db.close()

    def guards(self):
        for key in ('guardMessageInsertSql', 'guardMessageMoveSql', 'guardConversationDeleteSql'):
            self.db.execute(sql[key])

    def test_recovery_preserves_messages_and_is_idempotent(self):
        self.db.executemany('insert into chats values(?,?,?,?,?)',
            [(1, 7, '原文，🙂', 10, 'a'), (2, 7, '后续消息', 20, 'b')])
        before = self.db.execute('select * from chats').fetchall()
        for _ in range(2):
            self.db.execute(sql['recoverMissingConversationsSql'])
        self.assertEqual(self.db.execute('select id,createdAt,updatedAt,messageCount from conversations').fetchall(), [(7, 10, 20, 2)])
        self.assertEqual(self.db.execute('select * from chats').fetchall(), before)

    def test_delete_evidence_prevents_automatic_recovery(self):
        self.db.execute("insert into chats values(1,7,'保留消息',10,'a')")
        for kind, identity in [('message', 'a'), ('conversation', 'old-conversation')]:
            self.db.execute('delete from conversation_sync_tombstones')
            self.db.execute('insert into conversation_sync_tombstones values(?,?)', (kind, identity))
            self.db.execute(sql['recoverMissingConversationsSql'])
            self.assertEqual(self.db.execute('select count(*) from conversations').fetchone()[0], 0)

    def test_existing_conversation_metadata_is_preserved(self):
        self.db.execute("insert into conversations values(7,'用户标题',1,2,9,1)")
        self.db.execute("insert into chats values(1,7,'正文',10,'a')")
        self.db.execute(sql['recoverMissingConversationsSql'])
        self.assertEqual(self.db.execute('select title,messageCount,isPinned from conversations').fetchone(), ('用户标题', 9, 1))

    def test_invalid_writes_fail_and_deliberate_delete_still_works(self):
        self.guards()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("insert into chats values(1,7,'正文',10,'a')")
        self.db.execute("insert into conversations values(7,'标题',1,2,0,0)")
        self.db.execute("insert into chats values(1,7,'正文',10,'a')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('update chats set conversationId=8 where id=1')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('delete from conversations where id=7')
        self.db.execute('delete from chats where conversationId=7')
        self.db.execute('delete from conversations where id=7')
        self.assertEqual(self.db.execute('select count(*) from conversations').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
