import { TestBed } from '@angular/core/testing';
import { APP_PROVIDERS } from '../app.providers';
import { ContentLibraryFacade } from './content-library.facade';

describe('ContentLibraryFacade', () => {
  let facade: ContentLibraryFacade;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...APP_PROVIDERS] });
    facade = TestBed.inject(ContentLibraryFacade);
  });

  it('exposes the managed sources and requirements', () => {
    expect(facade.sources().length).toBe(5);
    expect(facade.requirements().length).toBe(29);
  });

  it('lists the requirements of a source', () => {
    expect(facade.requirementsOf('src-nis2-dnsc').length).toBe(4);
    expect(facade.requirementsOf('src-ai-act').length).toBe(8);
    expect(facade.requirementsOf('unknown').length).toBe(0);
  });

  it('finds a source by id and returns undefined for an unknown id', () => {
    expect(facade.sourceById('src-ai-act')?.frameworkId).toBe('ai-act');
    expect(facade.sourceById('unknown')).toBeUndefined();
  });

  it('reloads the library without changing the seeded content', async () => {
    await facade.reload();

    expect(facade.sources().length).toBe(5);
    expect(facade.requirements().length).toBe(29);
  });
});
