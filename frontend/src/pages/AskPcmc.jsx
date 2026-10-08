import { useRef, useState } from 'react';
import {
  Receipt, Droplets, FileText, Building2, Flame, Trees, MapPin, MessageSquareWarning,
  ArrowUpRight, RotateCcw, ShieldCheck, Phone,
} from 'lucide-react';
import useLabels from '../hooks/useLabels';
import { LogoMark } from '../components/Logo';
import ChatConversation from '../components/ChatConversation';

// Example questions are ones the knowledge base answers from official PCMC sources (see nlp/eval/kb_eval.py).
const TOPICS = [
  { key: 'property_tax', icon: Receipt, tone: 'violet' },
  { key: 'water', icon: Droplets, tone: 'sky' },
  { key: 'certificates', icon: FileText, tone: 'rose' },
  { key: 'building', icon: Building2, tone: 'amber' },
  { key: 'fire', icon: Flame, tone: 'rose' },
  { key: 'environment', icon: Trees, tone: 'teal' },
  { key: 'offices', icon: MapPin, tone: 'indigo' },
  { key: 'complaints', icon: MessageSquareWarning, tone: 'amber' },
];
const QUESTIONS_PER_TOPIC = 3;

export default function AskPcmc() {
  const { t } = useLabels();
  const [topic, setTopic] = useState(TOPICS[0].key);
  const [conversation, setConversation] = useState(0);
  const chatRef = useRef(null);
  const active = TOPICS.find((x) => x.key === topic);

  const ask = (question) => {
    chatRef.current?.ask(question);
    // On phones the chat sits below the topics; bring it into view.
    if (window.matchMedia('(max-width: 900px)').matches) {
      document.getElementById('ask-chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="ask-page">
      <aside className="ask-side">
        <div className="ask-intro">
          <p className="eyebrow">{t('ask_eyebrow')}</p>
          <h1 className="page-title">{t('ask_title')}</h1>
          <p className="page-copy">{t('ask_subtitle')}</p>
        </div>

        <p className="ask-label">{t('ask_topics')}</p>
        <div className="ask-topics" role="tablist" aria-label={t('ask_topics')}>
          {TOPICS.map(({ key, icon: Icon, tone }) => (
            <button key={key} type="button" role="tab" aria-selected={topic === key}
              className={`ask-topic tile-${tone} ${topic === key ? 'active' : ''}`} onClick={() => setTopic(key)}>
              <span className="ask-topic-icon"><Icon size={16} /></span>
              {t(`ask_topic_${key}`)}
            </button>
          ))}
        </div>

        <p className="ask-label">{t('ask_try')}</p>
        <div className="ask-questions" role="tabpanel">
          {Array.from({ length: QUESTIONS_PER_TOPIC }, (_, i) => t(`ask_q_${active.key}_${i + 1}`)).map((question) => (
            <button key={question} type="button" className="ask-question" onClick={() => ask(question)}>
              <span>{question}</span>
              <ArrowUpRight size={15} />
            </button>
          ))}
        </div>

        <div className="ask-note">
          <p><ShieldCheck size={15} /> {t('ask_note_sources')}</p>
          <p><Phone size={15} /> {t('ask_note_helpline')}</p>
        </div>
      </aside>

      <section className="ask-chat" id="ask-chat" aria-label={t('chat_title')}>
        <header className="chat-header">
          <span className="chat-avatar"><LogoMark size={30} /></span>
          <div><strong>{t('chat_title')}</strong><span>{t('chat_subtitle')}</span></div>
          <button type="button" className="ask-new" onClick={() => setConversation((n) => n + 1)}>
            <RotateCcw size={14} /> {t('ask_new_chat')}
          </button>
        </header>
        <ChatConversation key={conversation} ref={chatRef} autoFocus />
      </section>
    </div>
  );
}
