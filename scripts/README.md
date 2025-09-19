# Scripts

This directory contains utility scripts for development and testing.

## UI Preview

**`npm run preview`** - Displays a comprehensive preview of all UI design variations

This preview showcases:

### Driver Messages
- Standard driver messages (no header)
- Messages with timestamps (when 1+ minute has passed)
- Messages with navigator reactions

### System Messages
- Transition messages (🚀 without ⏺ symbol)
- Plan creation messages
- Tool usage indicators

### Navigator Tool Messages
- **Approvals**: Bright green ✓ (`#00ff00`)
- **Denials**: Bright red ✗ (`#ff0000`)
- **Code Reviews**: Cyan bullet •
- **Completion**: Green stop symbol ⏹

### Driver Tool Messages
- File operations (Read, Write, Edit, etc.)
- Review requests (🔍 without leading symbol)
- Guidance requests (🤔 without leading symbol)

## Key Design Features

- **Threading Symbol**: `⎿` (white, consistent across all navigator messages)
- **Multi-line Indentation**: Proper alignment for continuation lines
- **Smart Timestamps**: HH:MM format, shown when 1+ minute elapsed or on phase transitions
- **Character-based Layout**: 84 chars for driver messages, 88 for system messages
- **Clean Presentation**: No repetitive driver headers

## Usage

```bash
# Run the UI preview
npm run preview

# Or directly with tsx
npx tsx scripts/preview.tsx
```

The preview helps verify visual design changes before testing in the full application.