import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SettingsPanel from '../components/SettingsPanel';
import { AssessmentTab } from '../components/Dashboards/AssessmentTab';
import { StatusTab } from '../components/Dashboards/StatusTab';
import PredictabilityTab from '../components/Dashboards/PredictabilityTab';
import { QualityTab } from '../components/Dashboards/QualityTab';
import { fetchAssessment, createReportFromDashboard } from '../api/client';
import type { Assessment } from '../types';

export default function DashboardsPage() {
  const [activeTab, setActiveTab] = useState('assessment');
  const [assessmentData, setAssessmentData] = useState<Assessment | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAssessment('real', false)
      .then(data => setAssessmentData(data))
      .catch(err => console.error(err));
  }, []);

  const handleGenerateReport = async () => {
    try {
      setIsGenerating(true);
      const projectKey = (assessmentData as any)?.project_key || 'ALL';
      await createReportFromDashboard(projectKey);
      navigate('/reports');
    } catch (err) {
      console.error(err);
      alert('Failed to generate report.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <section className="nav-page active">
      <div className="dashboards-container">
        
        {/* Sub-tabs header */}
        <div className="sub-tabs-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Program Overview</h2>
            <button 
              className="btn btn-primary" 
              onClick={handleGenerateReport} 
              disabled={isGenerating || !assessmentData}
            >
              {isGenerating ? 'Generating...' : 'Export as Report'}
            </button>
          </div>
          <div className="sub-tabs" id="sub-tabs">
            <button 
              className={`tab ${activeTab === 'assessment' ? 'active' : ''}`}
              onClick={() => setActiveTab('assessment')}
            >
              Assessment
            </button>
            <button 
              className={`tab ${activeTab === 'status' ? 'active' : ''}`}
              onClick={() => setActiveTab('status')}
            >
              Delivery &amp; Blockers
            </button>
            <button 
              className={`tab ${activeTab === 'delivery' ? 'active' : ''}`}
              onClick={() => setActiveTab('delivery')}
            >
              Predictability
            </button>
            <button 
              className={`tab ${activeTab === 'quality' ? 'active' : ''}`}
              onClick={() => setActiveTab('quality')}
            >
              Quality &amp; Load
            </button>
            <button 
              className={`tab tab--assistant ${activeTab === 'assistant' ? 'active' : ''}`}
              onClick={() => setActiveTab('assistant')}
            >
              ✨ PA Settings
            </button>
          </div>
        </div>

        {/* Tab Contents */}
        <div className="tab-contents">
          {activeTab === 'assessment' && (
            <div className="tab-content active">
              {assessmentData ? <AssessmentTab assessmentData={assessmentData} /> : <p className="muted">Loading assessment...</p>}
            </div>
          )}
          {activeTab === 'status' && (
            <div className="tab-content active">
              {assessmentData ? <StatusTab assessmentData={assessmentData} /> : <p className="muted">Loading assessment...</p>}
            </div>
          )}
          {activeTab === 'delivery' && (
            <div className="tab-content active">
              {assessmentData ? <PredictabilityTab assessmentData={assessmentData} /> : <p className="muted">Loading assessment...</p>}
            </div>
          )}
          {activeTab === 'quality' && (
            <div className="tab-content active">
              {assessmentData ? <QualityTab assessmentData={assessmentData} /> : <p className="muted">Loading assessment...</p>}
            </div>
          )}
          {activeTab === 'assistant' && (
            <div className="tab-content active">
              <SettingsPanel />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
