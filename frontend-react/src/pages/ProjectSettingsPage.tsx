import { useState, useEffect } from 'react';
import { loadProjectSettings, saveProjectSettings } from '../api/client';
import type { ProjectSetting } from '../types';

export const ProjectSettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<ProjectSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const data = await loadProjectSettings();
      setSettings(data);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to load project settings.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await saveProjectSettings(settings);
      setSaveMessage('Settings saved successfully!');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      console.error(err);
      alert('Failed to save project settings.');
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = (index: number, field: keyof ProjectSetting, value: string | number | undefined) => {
    const newSettings = [...settings];
    newSettings[index] = { ...newSettings[index], [field]: value };
    setSettings(newSettings);
  };

  const addProject = () => {
    setSettings([
      ...settings,
      {
        key: '',
        name: '',
        description: '',
        target_release: '',
        tags: '',
        ai_guidelines: '',
        at_risk_blockers: 2,
        at_risk_delay_days: 5,
      },
    ]);
  };

  const removeProject = (index: number) => {
    const newSettings = [...settings];
    newSettings.splice(index, 1);
    setSettings(newSettings);
  };

  if (loading) {
    return (
      <div className="page-content">
        <header className="page-header">
          <h1 className="page-title">Project Settings</h1>
        </header>
        <div className="card">Loading...</div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <header className="page-header">
        <h1 className="page-title">Project Settings</h1>
        <p className="page-subtitle">Manage portfolio projects, thresholds, and AI guidelines.</p>
      </header>

      {error && <div className="card delta-red" style={{ padding: '16px', marginBottom: '16px' }}>{error}</div>}

      <div className="card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3>Tracked Projects</h3>
          <button className="btn-secondary" onClick={addProject}>+ Add Project</button>
        </div>

        {settings.map((project, i) => (
          <div key={i} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              
              <div className="settings-group">
                <label className="settings-label">Jira Project Key</label>
                <input 
                  className="settings-input" 
                  value={project.key} 
                  onChange={(e) => updateSetting(i, 'key', e.target.value)} 
                  placeholder="e.g. CHK"
                />
              </div>

              <div className="settings-group">
                <label className="settings-label">Display Name</label>
                <input 
                  className="settings-input" 
                  value={project.name} 
                  onChange={(e) => updateSetting(i, 'name', e.target.value)} 
                  placeholder="e.g. Checkout Flow"
                />
              </div>

              <div className="settings-group" style={{ gridColumn: '1 / -1' }}>
                <label className="settings-label">Description</label>
                <input 
                  className="settings-input" 
                  value={project.description} 
                  onChange={(e) => updateSetting(i, 'description', e.target.value)} 
                />
              </div>

              <div className="settings-group">
                <label className="settings-label">Target Release</label>
                <input 
                  className="settings-input" 
                  value={project.target_release || ''} 
                  onChange={(e) => updateSetting(i, 'target_release', e.target.value)} 
                  placeholder="e.g. 2024-Q3"
                />
              </div>

              <div className="settings-group">
                <label className="settings-label">Tags (comma separated)</label>
                <input 
                  className="settings-input" 
                  value={project.tags || ''} 
                  onChange={(e) => updateSetting(i, 'tags', e.target.value)} 
                  placeholder="e.g. E-Commerce, Security"
                />
              </div>

              <div className="settings-group">
                <label className="settings-label">At Risk Threshold: Blockers</label>
                <input 
                  className="settings-input" 
                  type="number"
                  value={project.at_risk_blockers || 0} 
                  onChange={(e) => updateSetting(i, 'at_risk_blockers', parseInt(e.target.value))} 
                />
              </div>

              <div className="settings-group">
                <label className="settings-label">At Risk Threshold: Delay Days</label>
                <input 
                  className="settings-input" 
                  type="number"
                  value={project.at_risk_delay_days || 0} 
                  onChange={(e) => updateSetting(i, 'at_risk_delay_days', parseInt(e.target.value))} 
                />
              </div>

              <div className="settings-group" style={{ gridColumn: '1 / -1' }}>
                <label className="settings-label">AI Guidelines</label>
                <textarea 
                  className="settings-textarea" 
                  rows={3}
                  value={project.ai_guidelines || ''} 
                  onChange={(e) => updateSetting(i, 'ai_guidelines', e.target.value)} 
                  placeholder="Specific instructions for AI when analyzing this project..."
                  style={{ width: '100%' }}
                />
              </div>

            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
               <button className="btn-secondary" style={{ borderColor: 'var(--risk-red)', color: 'var(--risk-red)' }} onClick={() => removeProject(i)}>
                 Remove Project
               </button>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' }}>
          <p className="settings-save-msg">{saveMessage}</p>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};
