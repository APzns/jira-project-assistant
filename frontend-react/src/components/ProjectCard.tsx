import { Link } from 'react-router-dom';
import type { ProjectData } from '../types';

interface ProjectCardProps {
  project: ProjectData;
}

export default function ProjectCard({ project }: ProjectCardProps) {
  return (
    <div className="project-card" style={{ cursor: 'pointer' }}>
      <Link to={`/projects/${project.key}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
        <div className="p-card-top">
          <div className="p-key-badge">{project.key}</div>
          <div className={`p-status-tag ${project.status === 'on-track' ? 'p-status-ok' : 'p-status-warn'}`}>
            <span className="p-status-dot"></span> {project.status === 'on-track' ? 'On Track' : 'At Risk'}
          </div>
        </div>
        <h3 className="p-title">{project.name}</h3>
        <p className="p-desc">{project.description}</p>
        
        <div className="p-progress-wrap">
          <div className="p-progress-header">
            <span>Delivery Progress</span>
            <strong>{project.progress}% {project.sp_total ? `(${project.sp_completed || 0} / ${project.sp_total} SP)` : ''}</strong>
          </div>
          <div className="p-progress-bar">
            <div className={`p-progress-fill ${project.status === 'on-track' ? 'p-fill-ok' : 'p-fill-warn'}`} style={{ width: `${project.progress}%` }}></div>
          </div>
        </div>

        <div className="p-meta-grid">
          <div className="p-meta-item">
            <span className="p-meta-label">Target Release</span>
            <span className="p-meta-value">{project.targetRelease}</span>
          </div>
          <div className="p-meta-item">
            <span className="p-meta-label">Blockers</span>
            {(() => {
              const blockersCount = Array.isArray(project.blockers) ? project.blockers.length : (project.blockers || 0);
              return (
                <span className={`p-meta-value ${blockersCount > 0 ? 'text-warn' : ''}`}>
                  {blockersCount > 0 ? blockersCount : 'None'}
                </span>
              );
            })()}
          </div>
        </div>

        <div className="p-tags">
          {project.tags.map((tag: string) => (
            <span key={tag} className="p-tag">{tag}</span>
          ))}
        </div>

        <div className="p-card-footer">
          <button className="btn-p-action btn-p-view-details">
            View Details &rarr;
          </button>
        </div>
      </Link>
    </div>
  );
}
