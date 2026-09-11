const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const launchAgentPlist = ({
  label,
  node,
  script,
  root,
  log,
  errorLog,
}: {
  label: string;
  node: string;
  script: string;
  root: string;
  log: string;
  errorLog: string;
}) =>
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${escapeXml(label)}</string><key>ProgramArguments</key><array><string>${escapeXml(node)}</string><string>${escapeXml(script)}</string><string>sync</string><string>--scheduled</string></array><key>StartInterval</key><integer>1800</integer><key>RunAtLoad</key><true/><key>EnvironmentVariables</key><dict><key>ATLAS_HOME</key><string>${escapeXml(root)}</string></dict><key>StandardOutPath</key><string>${escapeXml(log)}</string><key>StandardErrorPath</key><string>${escapeXml(errorLog)}</string></dict></plist>`;
