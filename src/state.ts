import { EventEmitter } from 'events';
import { AppState, StateTransition, InputFocus, AppStateSnapshot } from './types';

const transitionTable: Record<AppState, Partial<Record<StateTransition, AppState>>> = {
  [AppState.GAME_MINIMIZED]: {
    [StateTransition.TOGGLE]: AppState.GAME_ACTIVE,
    [StateTransition.CHILD_EXIT]: AppState.EXITING,
    [StateTransition.FATAL_ERROR]: AppState.EXITING,
  },
  [AppState.GAME_ACTIVE]: {
    [StateTransition.TOGGLE]: AppState.GAME_MINIMIZED,
    [StateTransition.MANUAL_PAUSE]: AppState.GAME_PAUSED,
    [StateTransition.MINIMIZE]: AppState.GAME_MINIMIZED,
    [StateTransition.CHILD_EXIT]: AppState.EXITING,
    [StateTransition.FATAL_ERROR]: AppState.EXITING,
  },
  [AppState.GAME_PAUSED]: {
    [StateTransition.TOGGLE]: AppState.GAME_ACTIVE,
    [StateTransition.RESUME]: AppState.GAME_ACTIVE,
    [StateTransition.MINIMIZE]: AppState.GAME_MINIMIZED,
    [StateTransition.CHILD_EXIT]: AppState.EXITING,
    [StateTransition.FATAL_ERROR]: AppState.EXITING,
  },
  [AppState.EXITING]: {},
};

export class StateMachine extends EventEmitter {
  private _state: AppState = AppState.GAME_MINIMIZED;

  get state(): AppState { return this._state; }

  get snapshot(): AppStateSnapshot {
    return {
      state: this._state,
      inputFocus: this.getInputFocus(),
      gameVisible: this._state === AppState.GAME_ACTIVE || this._state === AppState.GAME_PAUSED,
    };
  }

  transition(t: StateTransition): AppState {
    const nextState = transitionTable[this._state]?.[t];
    if (nextState === undefined) return this._state;
    const prev = this._state;
    this._state = nextState;
    this.emit('transition', { from: prev, to: nextState, trigger: t });
    return nextState;
  }

  private getInputFocus(): InputFocus {
    if (this._state === AppState.GAME_ACTIVE || this._state === AppState.GAME_PAUSED) return InputFocus.GAME;
    return InputFocus.CHILD;
  }
}
