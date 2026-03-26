import { Users } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { formatDuration } from '../../lib/format';

interface ContactsTabProps {
  contactsData: any;
  onSelectContact: (contact: any) => void;
}

export default function ContactsTab({ contactsData, onSelectContact }: ContactsTabProps) {
  return (
    <Card>
      <div className="divide-y divide-[var(--border)]">
        {!contactsData?.data?.length && (
          <div className="px-6 py-12 text-center">
            <Users className="w-10 h-10 mx-auto mb-3 text-[var(--text-muted)]" />
            <p className="text-[var(--text-secondary)]">אין אנשי קשר עדיין</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">אנשי קשר נוצרים אוטומטית כשמתקבלות שיחות</p>
          </div>
        )}
        {contactsData?.data?.map((contact: any) => {
          const followup = contact.contactFollowups?.[0];
          return (
            <div
              key={contact.id}
              className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
              onClick={() => onSelectContact(contact)}
            >
              <div className="flex items-center gap-3">
                {followup && (
                  <Badge variant={followup.status === 'EXECUTING' ? 'warning' : 'info'}>
                    פולואפ {followup.currentStepOrder}
                  </Badge>
                )}
                <span className="text-xs text-[var(--text-muted)]">
                  {contact.totalCalls} שיחות
                </span>
                {contact.totalDurationSec > 0 && (
                  <span className="text-xs text-[var(--text-muted)]">
                    {formatDuration(contact.totalDurationSec)}
                  </span>
                )}
                {contact.lastCallAt && (
                  <span className="text-xs text-[var(--text-muted)]">
                    אחרון: {new Date(contact.lastCallAt).toLocaleDateString('he-IL')}
                  </span>
                )}
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {contact.name || 'ללא שם'}
                </p>
                <p className="text-xs text-[var(--text-muted)]" dir="ltr">{contact.phone}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
