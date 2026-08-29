import { useParams, Link } from 'react-router-dom';
import type { ProjectData } from '../types';

import { useState, useEffect } from 'react';
import { loadProjectSettings } from '../api/client';

export function ProjectDetailPage() {
  const { key } = useParams<{ key: string }>();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProject() {
      try {
        const settings = await loadProjectSettings();
        const s = settings.find(p => p.key === key);
        if (s) {
          setProject({
            key: s.key,
            name: s.name,
            description: s.description,
            targetRelease: s.target_release || 'TBD',
            tags: Array.isArray(s.tags)
              ? s.tags
              : (s.tags ? (s.tags as string).split(',').map((t: string) => t.trim()) : []),
            status: s.status || 'on-track',
            progress: s.progress_pct ?? 0,
            blockers: s.blockers_count ?? 0,
            sp_completed: 0,
            sp_total: 0
          });
        }
      } catch (err) {
        console.error("Failed to load project details", err);
      } finally {
        setLoading(false);
      }
    }
    fetchProject();
  }, [key]);

  if (loading) {
    return <div style={{ padding: '24px' }}>Loading...</div>;
  }

  if (!project) {
    return (
      <section className="nav-page active">
        <div className="pd-container" style={{ padding: '2rem' }}>
          <h2>Project Not Found</h2>
          <Link to="/projects" className="btn-secondary">&larr; Back to Projects</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="nav-page active">
      <div className="pd-container">
        
        {/* Detail Header */}
        <div className="pd-header">
          <Link to="/projects" className="btn-secondary pd-back-btn">&larr; Back to Projects</Link>
          <div className="pd-header-top">
            <span className="p-key-badge">{project.key}</span>
            <span className={`p-status-tag ${project.status === 'on-track' ? 'p-status-ok' : 'p-status-warn'}`}>
              <span className="p-status-dot"></span> {project.status === 'on-track' ? 'On Track' : 'At Risk'}
            </span>
          </div>
          <h2 className="pd-title">{project.name}</h2>
          <p className="pd-desc">{project.description}</p>
        </div>

        {/* Dynamic content area populated from card */}
        <div className="pd-body">
          <div className="pd-section">
            <div className="p-progress-wrap">
              <div className="p-progress-header">
                <span>Delivery Progress</span>
                <strong>{project.progress}% {project.sp_total ? `(${project.sp_completed || 0} / ${project.sp_total} SP)` : ''}</strong>
              </div>
              <div className="p-progress-bar">
                <div className={`p-progress-fill ${project.status === 'on-track' ? 'p-fill-ok' : 'p-fill-warn'}`} style={{ width: `${project.progress}%` }}></div>
              </div>
            </div>
          </div>
          
          <div className="pd-section">
            <div className="p-meta-grid">
              <div className="p-meta-item">
                <span className="p-meta-label">Target Release</span>
                <span className="p-meta-val">{project.targetRelease}</span>
              </div>
              <div className="p-meta-item">
                <span className="p-meta-label">Blockers</span>
                {(() => {
                  const blockersCount = Array.isArray(project.blockers) ? project.blockers.length : (project.blockers || 0);
                  return (
                    <span className={`p-meta-val ${blockersCount > 0 ? 'text-warn' : ''}`}>
                      {blockersCount > 0 ? blockersCount : 'None'}
                    </span>
                  );
                })()}
              </div>
            </div>
            
            {Array.isArray(project.blockers) && project.blockers.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <span className="p-meta-label">Active Blockers:</span>
                <ul style={{ listStyleType: 'disc', paddingLeft: '1.5rem', marginTop: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  {project.blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}
                </ul>
              </div>
            )}
          </div>
          
          <div className="pd-section">
            <div className="p-tags">
              {project.tags.map((tag: string) => (
                <span key={tag} className="p-tag">{tag}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Detailed Tabs Area (Placeholder for Future Expansion) */}
        <div className="pd-tabs">
          <div className="pd-tab active">Overview</div>
          <div className="pd-tab">Metrics &amp; KPIs</div>
          <div className="pd-tab">Risks &amp; Blockers</div>
        </div>
        
        <div className="pd-tab-content">
          <p className="muted">Detailed project metrics and AI analysis will be loaded here.</p>
        </div>
      </div>
    </section>
  );
}
