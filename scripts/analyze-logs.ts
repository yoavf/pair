#!/usr/bin/env tsx

import { LogAnalyzer } from '../src/utils/logAnalyzer.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface CliOptions {
  logFile?: string;
  output?: 'text' | 'mermaid' | 'json';
  actor?: 'System' | 'Architect' | 'Navigator' | 'Driver';
  timeRange?: string;
  save?: string;
  hideNoise?: boolean;
  toolsOnly?: boolean;
  includeArchitect?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    output: 'text'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--log-file':
      case '-f':
        options.logFile = next;
        i++;
        break;
      case '--output':
      case '-o':
        if (['text', 'mermaid', 'json'].includes(next)) {
          options.output = next as any;
        }
        i++;
        break;
      case '--actor':
      case '-a':
        if (['System', 'Architect', 'Navigator', 'Driver'].includes(next)) {
          options.actor = next as any;
        }
        i++;
        break;
      case '--time-range':
      case '-t':
        options.timeRange = next;
        i++;
        break;
      case '--save':
      case '-s':
        options.save = next;
        i++;
        break;
      case '--hide-noise':
        options.hideNoise = true;
        break;
      case '--tools-only':
        options.toolsOnly = true;
        break;
      case '--include-architect':
        options.includeArchitect = true;
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Pair Programming Log Analyzer

Usage: tsx scripts/analyze-logs.ts [options]

Options:
  -f, --log-file <path>     Path to debug log file (default: ~/.pair/logs/pair-debug.log)
  -o, --output <format>     Output format: text, mermaid, json (default: text)
  -a, --actor <actor>       Filter by actor: System, Architect, Navigator, Driver
  -t, --time-range <range>  Filter by time range (format: HH:MM-HH:MM)
  -s, --save <path>         Save output to file
  --hide-noise             Hide repetitive system events (iterations, sse posts, etc.)
  --tools-only             Show only tool use/result events
  --include-architect      Include architect planning phase (hidden by default)
  -h, --help               Show this help

Examples:
  tsx scripts/analyze-logs.ts                                    # Generate text sequence diagram
  tsx scripts/analyze-logs.ts -o mermaid --hide-noise           # Clean Mermaid diagram
  tsx scripts/analyze-logs.ts -a Navigator                       # Show only Navigator events
  tsx scripts/analyze-logs.ts --tools-only                       # Show only tool interactions
  tsx scripts/analyze-logs.ts -o mermaid -s sequence.mmd         # Save Mermaid to file
  tsx scripts/analyze-logs.ts -t "10:30-11:00"                   # Show events in time range
`);
}

function parseTimeRange(timeRange: string): { start: Date, end: Date } {
  const today = new Date();
  const [startStr, endStr] = timeRange.split('-');

  const [startHour, startMin] = startStr.split(':').map(Number);
  const [endHour, endMin] = endStr.split(':').map(Number);

  const start = new Date(today);
  start.setHours(startHour, startMin, 0, 0);

  const end = new Date(today);
  end.setHours(endHour, endMin, 59, 999);

  return { start, end };
}

async function main() {
  const options = parseArgs();

  try {
    const analyzer = new LogAnalyzer(options.logFile);
    console.log(`📊 Analyzing log file: ${analyzer['logFile']}`);

    let events = analyzer.toSequenceEvents();
    console.log(`Found ${events.length} events`);

    // Apply filters
    if (options.hideNoise) {
      events = events.filter(event => {
        // Filter out repetitive system noise
        const isNoise =
          event.action.includes('implementation loop iteration') ||
          event.action.includes('mcp sse post') ||
          event.action.includes('mcp sse connected') ||
          event.action.includes('continuing with prompt') ||
          event.action.includes('intermediate batch') ||
          event.action.includes('tool result observed') ||
          event.action.includes('tool pending');
        return !isNoise;
      });
      console.log(`Filtered to ${events.length} events (noise hidden)`);
    }

    if (options.toolsOnly) {
      events = events.filter(event =>
        event.action.startsWith('🔧 ') || event.action.startsWith('📤 ')
      );
      console.log(`Filtered to ${events.length} tool events only`);
    }

    if (options.actor) {
      events = analyzer.filterByActor(options.actor, events);
      console.log(`Filtered to ${events.length} events for actor: ${options.actor}`);
    }

    if (options.timeRange) {
      const { start, end } = parseTimeRange(options.timeRange);
      events = analyzer.filterByTimeRange(start, end, events);
      console.log(`Filtered to ${events.length} events in time range: ${options.timeRange}`);
    }

    // Generate output
    let output = '';

    switch (options.output) {
      case 'text':
        output = analyzer.generateTextSequenceDiagram(events, options.includeArchitect);
        break;
      case 'mermaid':
        output = analyzer.generateMermaidSequenceDiagram(events, options.includeArchitect);
        break;
      case 'json':
        output = JSON.stringify(events, null, 2);
        break;
    }

    // Save or display output
    if (options.save) {
      fs.writeFileSync(options.save, output, 'utf-8');
      console.log(`💾 Output saved to: ${options.save}`);

      // Also show a preview
      const lines = output.split('\n');
      if (lines.length > 20) {
        console.log('\n📋 Preview (first 20 lines):');
        console.log(lines.slice(0, 20).join('\n'));
        console.log(`... (${lines.length - 20} more lines in file)`);
      } else {
        console.log('\n📋 Complete output:');
        console.log(output);
      }
    } else {
      console.log('\n📋 Output:');
      console.log(output);
    }

    // Show summary statistics
    const actorStats = events.reduce((acc, event) => {
      acc[event.actor] = (acc[event.actor] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('\n📈 Summary:');
    Object.entries(actorStats).forEach(([actor, count]) => {
      console.log(`  ${actor}: ${count} events`);
    });

    if (events.length > 0) {
      const timeSpan = new Date(events[events.length - 1].timestamp).getTime() -
                      new Date(events[0].timestamp).getTime();
      console.log(`  Duration: ${Math.round(timeSpan / 1000 / 60)} minutes`);
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main().catch(console.error);