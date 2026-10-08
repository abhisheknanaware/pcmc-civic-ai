import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogoMark } from './Logo';
import { MessageCircle, X, Maximize2 } from 'lucide-react';
import useLabels from '../hooks/useLabels';
import ChatConversation from './ChatConversation';

// Floating assistant shown on the public pages; the full-page version lives at /ask.
export default function ChatWidget() {
  const { t } = useLabels();
  const [open, setOpen] = useState(false);

  // Other parts of the page (e.g. the homepage buttons) can open the assistant.
  useEffect(() => {
    const openChat = () => setOpen(true);
    window.addEventListener('pcmc:open-chat', openChat);
    return () => window.removeEventListener('pcmc:open-chat', openChat);
  }, []);

  if (!open) {
    return (
      <button type="button" className="chat-launcher" onClick={() => setOpen(true)} aria-label={t('chat_open')}>
        <MessageCircle size={22} /> <span>{t('chat_open')}</span>
      </button>
    );
  }

  return (
    <section className="chat-panel" role="dialog" aria-label={t('chat_title')}>
      <header className="chat-header">
        <span className="chat-avatar"><LogoMark size={30} /></span>
        <div><strong>{t('chat_title')}</strong><span>{t('chat_subtitle')}</span></div>
        <Link to="/ask" className="chat-close" onClick={() => setOpen(false)} aria-label={t('ask_open_full')} title={t('ask_open_full')}><Maximize2 size={16} /></Link>
        <button type="button" className="chat-close" onClick={() => setOpen(false)} aria-label={t('close')}><X size={18} /></button>
      </header>
      <ChatConversation onLeave={() => setOpen(false)} autoFocus />
    </section>
  );
}
