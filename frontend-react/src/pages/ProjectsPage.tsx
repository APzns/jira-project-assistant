import { useState, useEffect } from 'react';
import type { ProjectData } from '../types';
import ProjectCard from '../components/ProjectCard';
import { loadProjectSettings } from '../api/client';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProjects() {
      try {
        const settings = await loadProjectSettings();
        // Map settings to ProjectData, mocking the metrics for now
        const mapped: ProjectData[] = settings.map(s => ({
          key: s.key,
          name: s.name,
          description: s.description,
          targetRelease: s.target_release || 'TBD',
          tags: s.tags ? s.tags.split(',').map(t => t.trim()) : [],
          status: Math.random() > 0.5 ? 'on-track' : 'at-risk', // Mock status
          progress: Math.floor(Math.random() * 100), // Mock progress
          blockers: Math.random() > 0.5 ? ['Mock blocker'] : [], // Mock blockers
          sp_completed: 0,
          sp_total: 0
        }));
        setProjects(mapped);
      } catch (err) {
        console.error("Failed to load projects", err);
      } finally {
        setLoading(false);
      }
    }
    fetchProjects();
  }, []);

  if (loading) return <div style={{ padding: '24px' }}>Loading projects...</div>;

  return (
    <section className="nav-page active">
      <div className="projects-page-container">
        <div>
          <div className="projects-header">
            <div className="projects-title-area">
              <h2>Projects</h2>
              <p className="muted">Active enterprise software delivery projects under the enterprise portfolio.</p>
            </div>
            <div className="projects-stats-strip">
              <div className="stats-item">
                <span className="stats-val">{projects.length}</span>
                <span className="stats-label">Active</span>
              </div>
              <div className="stats-item">
                <span className="stats-val text-ok">{projects.filter(p => p.status === 'on-track').length}</span>
                <span className="stats-label">On Track</span>
              </div>
              <div className="stats-item">
                <span className="stats-val text-warn">{projects.filter(p => p.status === 'at-risk').length}</span>
                <span className="stats-label">At Risk</span>
              </div>
              <div className="stats-item">
                <span className="stats-val text-muted">--</span>
                <span className="stats-label">Epics</span>
              </div>
            </div>
          </div>

          <div className="projects-grid">
            {projects.map((p) => (
              <ProjectCard key={p.key} project={p} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
