import { useState } from 'react';
import { Send, Sparkles } from 'lucide-react';

const ReplyBox = ({ generatedReply, onSend }) => {
  const [reply, setReply] = useState(generatedReply || '');

  return (
    <div className="card mt-4" style={{ borderLeft: '4px solid var(--primary)' }}>
      <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Sparkles size={18} style={{ color: 'var(--primary)' }} />
        AI Suggested Reply
      </h3>
      
      <textarea 
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        rows="6"
        style={{ marginBottom: '1rem' }}
        placeholder="Type your response to the customer..."
      />
      
      <div className="flex justify-between items-center">
        <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          You can edit the AI suggestion before sending.
        </span>
        <button onClick={() => onSend(reply)}>
          <Send size={18} /> Send Reply
        </button>
      </div>
    </div>
  );
};

export default ReplyBox;
