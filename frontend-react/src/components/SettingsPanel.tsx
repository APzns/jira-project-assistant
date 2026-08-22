import { useState, useEffect } from 'react';
import type { AISettings } from '../types';
import { loadSettings, saveSettings } from '../api/client';

export default function SettingsPanel() {
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    loadSettings().then(s => {
      setSettings(s);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, []);

  if (loading || !settings) return <div>Loading settings...</div>;

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings(settings);
      setSaveMsg('Settings saved successfully!');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (e) {
      setSaveMsg('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pa-settings-panel">
      <div className="settings-group">
        <label className="settings-label">Stakeholder Persona</label>
        <select 
          className="settings-select"
          value={settings.stakeholder as string || 'executive'}
          onChange={(e) => setSettings({ ...settings, stakeholder: e.target.value })}
        >
          <option value="executive">Executive Briefing</option>
          <option value="program_manager">Program Manager</option>
          <option value="engineer">Engineering Lead</option>
        </select>
      </div>

      <div className="settings-group">
        <label className="settings-label">Summary Verbosity</label>
        <select 
          className="settings-select"
          value={settings.summary_verbosity || 'brief'}
          onChange={(e) => setSettings({ ...settings, summary_verbosity: e.target.value as any })}
        >
          <option value="brief">Brief</option>
          <option value="detailed">Detailed</option>
        </select>
      </div>

      <div className="pa-settings-footer">
        <p className="settings-save-msg">{saveMsg}</p>
        <button 
          className="btn-primary pa-save-btn" 
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}
