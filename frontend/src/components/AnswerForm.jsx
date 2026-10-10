import { useState } from 'react';
import { Loader, Save, X } from 'lucide-react';
import useLabels from '../hooks/useLabels';
import { useMeta } from '../context/MetaContext';
import api from '../services/api';

/** Officer writes (or edits) a verified answer the chatbot will use immediately. */
export default function AnswerForm({ initial, onSaved, onCancel }) {
  const L = useLabels();
  const { t } = L;
  const { departments = [] } = useMeta();
  const [form, setForm] = useState({
    id: initial?.id, title: initial?.title || '', answer: initial?.answer || '',
    questions: (initial?.questions || []).join('\n'), department: initial?.department || '',
    sourceUrl: initial?.sourceUrl || '', serviceUrl: initial?.serviceUrl || '', serviceLabel: initial?.serviceLabel || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/kb/answers', {
        ...form,
        questions: form.questions.split('\n').map((q) => q.trim()).filter(Boolean),
        department: form.department || null,
        sourceUrl: form.sourceUrl.trim() || null, serviceUrl: form.serviceUrl.trim() || null, serviceLabel: form.serviceLabel.trim() || null,
      });
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.message || t('kb_answer_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="answer-form" onSubmit={submit}>
      <div className="answer-form-head">
        <h3>{t(form.id ? 'kb_answer_edit' : 'kb_answer_new')}</h3>
        <button type="button" className="chat-close answer-close" onClick={onCancel} aria-label={t('close')}><X size={18} /></button>
      </div>
      <p className="form-note">{t('kb_answer_note')}</p>
      <div className="form-group">
        <label htmlFor="ans-title">{t('kb_answer_title')}</label>
        <input id="ans-title" value={form.title} onChange={set('title')} maxLength={200} required placeholder={t('kb_answer_title_ph')} />
      </div>
      <div className="form-group">
        <label htmlFor="ans-text">{t('kb_answer_text')}</label>
        <textarea id="ans-text" value={form.answer} onChange={set('answer')} maxLength={3000} rows={6} required placeholder={t('kb_answer_text_ph')} />
      </div>
      <div className="form-group">
        <label htmlFor="ans-q">{t('kb_answer_questions')}</label>
        <textarea id="ans-q" value={form.questions} onChange={set('questions')} rows={3} placeholder={t('kb_answer_questions_ph')} />
      </div>
      <div className="grid grid-2">
        <div className="form-group">
          <label htmlFor="ans-dept">{t('label_department')}</label>
          <select id="ans-dept" value={form.department} onChange={set('department')}>
            <option value="">{t('kb_answer_any_dept')}</option>
            {departments.filter((d) => !d.external).map((d) => <option key={d.id} value={d.id}>{L.department(d.id)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="ans-src">{t('kb_answer_source')}</label>
          <input id="ans-src" type="url" value={form.sourceUrl} onChange={set('sourceUrl')} placeholder="https://www.pcmcindia.gov.in/..." />
        </div>
        <div className="form-group">
          <label htmlFor="ans-svc">{t('kb_answer_service')}</label>
          <input id="ans-svc" type="url" value={form.serviceUrl} onChange={set('serviceUrl')} placeholder="https://..." />
        </div>
        <div className="form-group">
          <label htmlFor="ans-svcl">{t('kb_answer_service_label')}</label>
          <input id="ans-svcl" value={form.serviceLabel} onChange={set('serviceLabel')} maxLength={60} placeholder={t('kb_answer_service_label_ph')} />
        </div>
      </div>
      {error && <p className="chat-error">{error}</p>}
      <div className="answer-form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>{t('cancel')}</button>
        <button type="submit" className="button" disabled={saving}>{saving ? <Loader size={16} className="spin" /> : <Save size={16} />} {t('kb_answer_save')}</button>
      </div>
    </form>
  );
}
