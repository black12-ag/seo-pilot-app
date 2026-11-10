// A drawn preview of the Rank Tracking page with example data. It's an
// illustration, not a screenshot: every self-hosted copy serves this page, so
// it must never carry anyone's real site or numbers.

const rows = [
  {
    query: "running shoes for flat feet",
    position: "3.2",
    change: "+1.4",
    impressions: "1,920",
    clicks: "214",
  },
  {
    query: "best trail running shoes",
    position: "6.8",
    change: "+2.1",
    impressions: "1,305",
    clicks: "61",
  },
  {
    query: "example running club",
    position: "1.0",
    change: "0.0",
    impressions: "540",
    clicks: "402",
  },
  {
    query: "how to clean running shoes",
    position: "11.4",
    change: "+3.6",
    impressions: "488",
    clicks: "9",
  },
];

// Average position over 30 days (lower is better), drawn top = 1.
const positions = [
  14, 13.5, 13.8, 12.9, 12.4, 12.7, 11.8, 11.2, 11.5, 10.6, 10.1, 10.4, 9.6,
  9.1, 9.3, 8.4, 8.0, 8.3, 7.5, 7.1, 7.3, 6.6, 6.2, 6.4, 5.7, 5.4, 5.6, 5.0,
  4.7, 4.5,
];

function chartPath() {
  const width = 600;
  const height = 150;
  const step = width / (positions.length - 1);
  const y = (position: number) => ((position - 1) / 15) * height;
  const points = positions.map(
    (position, index) =>
      `${(index * step).toFixed(1)},${y(position).toFixed(1)}`,
  );
  return {
    line: `M${points.join(" L")}`,
    area: `M0,${height} L${points.join(" L")} L${width},${height} Z`,
  };
}

export function ProductPreview() {
  const { line, area } = chartPath();
  return (
    <div className="window">
      <div className="window-bar" aria-hidden="true">
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
        <span className="window-url">your-server / Rank Tracking</span>
      </div>
      <div className="window-body">
        <aside className="preview-nav" aria-hidden="true">
          <p className="preview-project">
            <strong>Example Shop</strong>
            <span>example.com</span>
          </p>
          {[
            "Dashboard",
            "Opportunities",
            "Keyword Research",
            "Backlinks",
            "AI Visibility",
            "Rank Tracking",
            "Site Audit",
            "SAM Assistant",
          ].map((item) => (
            <span
              key={item}
              className={
                item === "Rank Tracking"
                  ? "preview-link active"
                  : "preview-link"
              }
            >
              {item}
            </span>
          ))}
        </aside>
        <div className="preview-main">
          <div className="preview-head">
            <div>
              <p className="preview-title">example.com</p>
              <p className="preview-sub">Search Console · Daily · Free</p>
            </div>
            <span className="preview-badge">Avg. position 4.5 ↑</span>
          </div>
          <div className="preview-chart">
            <svg
              viewBox="0 0 600 150"
              preserveAspectRatio="none"
              role="img"
              aria-label="Example chart: average position improving from 14 to 4.5 over 30 days"
            >
              <defs>
                <linearGradient id="rank-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#ff3b1d" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#ff3b1d" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[30, 60, 90, 120].map((gridY) => (
                <line
                  key={gridY}
                  x1="0"
                  x2="600"
                  y1={gridY}
                  y2={gridY}
                  className="grid-line"
                />
              ))}
              <path d={area} fill="url(#rank-fill)" />
              <path d={line} className="chart-line" />
            </svg>
          </div>
          <table className="preview-table">
            <thead>
              <tr>
                <th scope="col">Query</th>
                <th scope="col">Avg. position</th>
                <th scope="col" className="hide-sm">
                  Impressions
                </th>
                <th scope="col">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.query}>
                  <td>{row.query}</td>
                  <td>
                    {row.position} <span className="gain">{row.change}</span>
                  </td>
                  <td className="hide-sm">{row.impressions}</td>
                  <td>{row.clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
