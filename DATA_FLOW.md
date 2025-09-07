# Claude Pair Programming - Data Flow

## High-level Flow

**Phase 1: Planning**
- Architect creates an implementation plan
- Plan is displayed and saved for reference

**Phase 2: Implementation**
- Navigator provides guidance using read-only tools
- Driver implements changes based on plan and navigator feedback
- Both agents coordinate their work through structured communication

## Data Flow

```
### Initialization
1. Create Architect for planning phase
2. Create Navigator for guidance (read-only tools)
3. Create Driver for implementation (full tool access)
4. Set up event handlers for coordination

### Planning Phase
1. Architect receives task and creates implementation plan
2. Plan is displayed to user and saved locally
3. System transitions to implementation phase

### Implementation Phase
1. Navigator monitors driver progress using read-only tools
2. Driver implements changes based on plan and navigator feedback
3. Messages flow between agents with coordination delays
4. Special commands (Nod, Feedback, CodeReview, Complete) provide structured communication

### Message Coordination
- Driver messages are batched and sent to navigator
- Navigator feedback is sent to driver with appropriate delays
- Review requests bypass normal batching for immediate attention
- System prevents message conflicts through careful timing

### Completion
- Navigator or Driver can signal task completion
- Turn limits provide fallback termination
- Graceful cleanup on completion or interruption
## Key Components

- **src/index.ts** - Main orchestrator and event coordination
- **src/conversations/** - Agent implementations (Architect, Navigator, Driver)
- **src/utils/navigatorCommands.ts** - Communication command system
- **src/components/** - UI rendering components

## Configuration

- Message timing can be adjusted via environment variables
- Turn limits prevent infinite loops
- Logging available for debugging
- Session time limits protect against runaway execution
