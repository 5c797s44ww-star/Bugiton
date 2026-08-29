import type { DataQualityIssue } from '../lib/types';

interface Props {
  issues: DataQualityIssue[];
}

export function DataQualityPanel({ issues }: Props) {
  if (issues.length === 0) {
    return (
      <div className="panel">
        <h2>Data quality</h2>
        <p className="ok-banner">No data quality issues detected.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Data quality</h2>
      <ul className="issue-list">
        {issues.map((issue, i) => (
          <li key={i} className={`issue issue-${issue.severity}`}>
            <span className="issue-severity">{issue.severity}</span>
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
