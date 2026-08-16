import { describe, it, expect } from 'vitest'
import {
  sameMemberSet,
  hoveredHalf,
  hoveredCardAt,
  insertionIndexFor,
  reorderedList,
  cardShift,
  masterWithUngroupedOrder,
  pointInRect,
  projectDropAt,
  folderDropAt,
  sameDropTarget,
} from './drag-reorder'
import type { ProjectFolder } from '@/lib/tauri-bindings'

/** A folder with the given members (ids are irrelevant to the geometry). */
function folder(paths: string[]): ProjectFolder {
  return { id: 'f1', name: 'Set list', projectPaths: paths }
}

describe('drag-reorder (v1.1.2 T4, spec issue #8)', () => {
  describe('hoveredHalf — midpoint drop rule', () => {
    it('above the midpoint drops before, at or below drops after', () => {
      const card = { top: 100, height: 40 }
      expect(hoveredHalf(100, card)).toBe('before')
      expect(hoveredHalf(119, card)).toBe('before')
      // The midpoint itself counts as the lower half.
      expect(hoveredHalf(120, card)).toBe('after')
      expect(hoveredHalf(140, card)).toBe('after')
    })
  })

  describe('hoveredCardAt — hit-testing the static slot layout', () => {
    // Three cards pitched 61px from top 100, each 57px tall.
    const space = {
      top: 100,
      left: 20,
      right: 300,
      cardHeight: 57,
      stride: 61,
      count: 3,
    }

    it('finds the slot under the pointer and picks its half by midpoint', () => {
      expect(hoveredCardAt(150, 110, space)).toEqual({
        index: 0,
        half: 'before',
      })
      // Slot 0 spans 100..161; its card's midpoint sits at 128.5.
      expect(hoveredCardAt(150, 128, space)).toEqual({
        index: 0,
        half: 'before',
      })
      expect(hoveredCardAt(150, 129, space)).toEqual({
        index: 0,
        half: 'after',
      })
      expect(hoveredCardAt(150, 200, space)).toEqual({
        index: 1,
        half: 'after',
      })
    })

    it("a slot's trailing gap counts as its card's lower half", () => {
      // Slot 2 spans 222..283; its card ends at 279, the gap at 281 still
      // reads as "after card 2".
      expect(hoveredCardAt(150, 281, space)).toEqual({
        index: 2,
        half: 'after',
      })
    })

    it('outside the list — either axis — there is no target', () => {
      expect(hoveredCardAt(10, 150, space)).toBeNull()
      expect(hoveredCardAt(310, 150, space)).toBeNull()
      expect(hoveredCardAt(150, 99, space)).toBeNull()
      expect(hoveredCardAt(150, 283, space)).toBeNull()
    })

    it('degenerate spaces never match', () => {
      expect(hoveredCardAt(150, 150, { ...space, stride: 0 })).toBeNull()
      expect(hoveredCardAt(150, 150, { ...space, count: 0 })).toBeNull()
    })
  })

  describe('insertionIndexFor', () => {
    it('before keeps the hovered index, after takes the next slot', () => {
      expect(insertionIndexFor(2, 'before')).toBe(2)
      expect(insertionIndexFor(2, 'after')).toBe(3)
    })
  })

  describe('sameMemberSet', () => {
    it('ignores order but not members or length', () => {
      expect(sameMemberSet(['/a', '/b'], ['/b', '/a'])).toBe(true)
      expect(sameMemberSet(['/a'], ['/a', '/b'])).toBe(false)
      expect(sameMemberSet(['/a', '/b'], ['/a', '/c'])).toBe(false)
      expect(sameMemberSet([], [])).toBe(true)
      // A duplicate member is not the same member set, whatever the length.
      expect(sameMemberSet(['/a', '/b'], ['/a', '/a'])).toBe(false)
    })
  })

  describe('reorderedList — projected visible order', () => {
    const list = ['/a', '/b', '/c', '/d']

    it('dragging down onto the top half of a lower card lands before it', () => {
      // '/a' (index 0) dropped before '/c' (index 2).
      expect(reorderedList(list, 0, insertionIndexFor(2, 'before'))).toEqual([
        '/b',
        '/a',
        '/c',
        '/d',
      ])
    })

    it('dragging down onto the bottom half of a lower card lands after it', () => {
      expect(reorderedList(list, 0, insertionIndexFor(2, 'after'))).toEqual([
        '/b',
        '/c',
        '/a',
        '/d',
      ])
    })

    it('dragging up onto the top half of a higher card lands before it', () => {
      // '/d' (index 3) dropped before '/b' (index 1).
      expect(reorderedList(list, 3, insertionIndexFor(1, 'before'))).toEqual([
        '/a',
        '/d',
        '/b',
        '/c',
      ])
    })

    it('dragging up onto the bottom half of a higher card lands after it', () => {
      expect(reorderedList(list, 3, insertionIndexFor(1, 'after'))).toEqual([
        '/a',
        '/b',
        '/d',
        '/c',
      ])
    })

    it('no insertion, landing on itself, or an adjacent no-move keeps the same reference', () => {
      expect(reorderedList(list, 1, null)).toBe(list)
      expect(reorderedList(list, 1, 1)).toBe(list)
      expect(reorderedList(list, 1, 2)).toBe(list)
      // Hovering the dragged card's own halves is exactly the adjacent case.
      expect(reorderedList(list, 2, insertionIndexFor(2, 'before'))).toBe(list)
      expect(reorderedList(list, 2, insertionIndexFor(2, 'after'))).toBe(list)
    })

    it('clamps out-of-range insertion indices and ignores invalid sources', () => {
      expect(reorderedList(['/a', '/b'], 1, 99)).toEqual(['/a', '/b'])
      expect(reorderedList(list, -1, 0)).toBe(list)
      expect(reorderedList(list, 4, 0)).toBe(list)
    })

    it('moves to the very ends of the list', () => {
      expect(reorderedList(list, 1, 4)).toEqual(['/a', '/c', '/d', '/b'])
      expect(reorderedList(list, 3, 0)).toEqual(['/d', '/a', '/b', '/c'])
    })
  })

  describe('cardShift — yield transforms opening the gap', () => {
    const STRIDE = 61
    const shifts = (
      from: number,
      insertion: number | null,
      count = 4
    ): number[] =>
      Array.from({ length: count }, (_, index) =>
        cardShift(from, insertion, index, STRIDE)
      )

    it('dropping further down slides the spanned cards up into the old slot', () => {
      // '/a' (0) before '/c' (2): cards 1 shifts up, the gap opens at slot 1.
      expect(shifts(0, 2)).toEqual([0, -STRIDE, 0, 0])
      // ...after '/c' (insertion 3): cards 1 and 2 shift up, gap at slot 2.
      expect(shifts(0, 3)).toEqual([0, -STRIDE, -STRIDE, 0])
    })

    it('dropping higher up slides the spanned cards down past the gap', () => {
      // '/d' (3) before '/b' (1): cards 1 and 2 shift down, gap at slot 1.
      expect(shifts(3, 1)).toEqual([0, STRIDE, STRIDE, 0])
      // '/d' (3) after '/b' (insertion 2): only card 2 shifts down.
      expect(shifts(3, 2)).toEqual([0, 0, STRIDE, 0])
    })

    it('no insertion or a no-move drop yields nothing', () => {
      expect(shifts(1, null)).toEqual([0, 0, 0, 0])
      expect(shifts(1, 1)).toEqual([0, 0, 0, 0])
      expect(shifts(1, 2)).toEqual([0, 0, 0, 0])
    })

    it('the dragged card itself never shifts (the clone represents it)', () => {
      expect(cardShift(2, 0, 2, STRIDE)).toBe(0)
    })
  })

  describe('masterWithUngroupedOrder — top-level drops keep folder slots', () => {
    it('remaps the master list so the ungrouped segment matches the new order', () => {
      const master = ['/a', '/b', '/c', '/d', '/e']
      const folders = [folder(['/b', '/d'])]
      // Ungrouped [a, c, e] dragged to [c, e, a].
      expect(
        masterWithUngroupedOrder(master, folders, ['/c', '/e', '/a'])
      ).toEqual(['/c', '/b', '/e', '/d', '/a'])
    })

    it('returns the same reference when the new set is not the old ungrouped set', () => {
      const master = ['/a', '/b', '/c']
      const folders = [folder(['/b'])]
      expect(masterWithUngroupedOrder(master, folders, ['/a'])).toBe(master)
      expect(masterWithUngroupedOrder(master, folders, ['/a', '/b'])).toBe(
        master
      )
      expect(
        masterWithUngroupedOrder(master, folders, ['/a', '/c', '/x'])
      ).toBe(master)
    })
  })

  describe('folder drop targets (v1.1.2 T5, spec issue #9)', () => {
    // Two project cards pitched 61px from top 100, then the folder cards
    // further down (three, pitched the same).
    const listSpace = {
      top: 100,
      left: 20,
      right: 300,
      cardHeight: 57,
      stride: 61,
      count: 2,
    }
    const folderSpace = {
      top: 400,
      left: 20,
      right: 300,
      cardHeight: 57,
      stride: 61,
      count: 3,
    }
    const breadcrumb = { top: 0, left: 10, right: 310, bottom: 24 }

    describe('pointInRect', () => {
      it('includes the edges and rejects either axis outside', () => {
        expect(pointInRect(10, 0, breadcrumb)).toBe(true)
        expect(pointInRect(310, 24, breadcrumb)).toBe(true)
        expect(pointInRect(9, 12, breadcrumb)).toBe(false)
        expect(pointInRect(150, 25, breadcrumb)).toBe(false)
      })
    })

    describe('projectDropAt — one resolution for a project drag', () => {
      it('over the project cards keeps the list (reorder) target', () => {
        expect(
          projectDropAt(150, 129, {
            list: listSpace,
            folders: folderSpace,
            breadcrumb: null,
          })
        ).toEqual({
          kind: 'list',
          index: 0,
          half: 'after',
        })
      })

      it('below the list, over a folder card, resolves to that folder', () => {
        // Folder slot 1 spans 461..522.
        expect(
          projectDropAt(150, 500, {
            list: listSpace,
            folders: folderSpace,
            breadcrumb: null,
          })
        ).toEqual({
          kind: 'folder',
          index: 1,
        })
      })

      it('a folder hit still wins with the list space absent (folder view)', () => {
        expect(
          projectDropAt(150, 410, {
            list: null,
            folders: folderSpace,
            breadcrumb: null,
          })
        ).toEqual({
          kind: 'folder',
          index: 0,
        })
      })

      it('inside the folder view the breadcrumb bar outranks everything', () => {
        expect(
          projectDropAt(150, 12, { list: listSpace, folders: null, breadcrumb })
        ).toEqual({
          kind: 'breadcrumb',
        })
      })

      it('between the segments, or with no spaces, there is no target', () => {
        // The folder header row sits at ~350: outside both hit spaces.
        expect(
          projectDropAt(150, 350, {
            list: listSpace,
            folders: folderSpace,
            breadcrumb: null,
          })
        ).toBeNull()
        expect(
          projectDropAt(150, 500, {
            list: null,
            folders: null,
            breadcrumb: null,
          })
        ).toBeNull()
      })
    })

    describe('folderDropAt — folder drags only reorder the folder area', () => {
      it('hits inside the folder space become list targets', () => {
        expect(folderDropAt(150, 500, folderSpace)).toEqual({
          kind: 'list',
          index: 1,
          half: 'after',
        })
      })

      it('the project list never reacts to a folder drag', () => {
        expect(folderDropAt(150, 129, folderSpace)).toBeNull()
        expect(folderDropAt(150, 400, null)).toBeNull()
      })
    })

    describe('sameDropTarget', () => {
      it('matches on kind and payload', () => {
        expect(sameDropTarget(null, null)).toBe(true)
        expect(
          sameDropTarget(
            { kind: 'folder', index: 1 },
            { kind: 'folder', index: 1 }
          )
        ).toBe(true)
        expect(
          sameDropTarget({ kind: 'breadcrumb' }, { kind: 'breadcrumb' })
        ).toBe(true)
        expect(
          sameDropTarget(
            { kind: 'list', index: 1, half: 'after' },
            { kind: 'list', index: 1, half: 'before' }
          )
        ).toBe(false)
        expect(
          sameDropTarget(
            { kind: 'folder', index: 1 },
            { kind: 'list', index: 1, half: 'after' }
          )
        ).toBe(false)
        expect(sameDropTarget(null, { kind: 'breadcrumb' })).toBe(false)
      })
    })
  })
})
