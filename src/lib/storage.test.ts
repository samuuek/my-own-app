import {loadWorkspace,saveWorkspace} from './storage'
import {beforeEach,expect,test} from 'vitest'
beforeEach(()=>localStorage.clear())
test('saves and restores versioned workspace data',()=>{saveWorkspace('x',{note:'想法'});expect(loadWorkspace('x',{note:''})).toEqual({note:'想法'})})
test('falls back for missing or damaged data',()=>{localStorage.setItem('siyu:x','bad');expect(loadWorkspace('x',[])).toEqual([])})
