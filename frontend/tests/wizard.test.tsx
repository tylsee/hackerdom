import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Wizard } from '../src/pages/Wizard';
import { Processing } from '../src/pages/Processing';
import { initialWizard } from '../src/data';
afterEach(cleanup);
function setup(step: number, overrides = {}) {
  const setData = vi.fn(),
    next = vi.fn();
  render(
    <Wizard
      step={step}
      data={{ ...initialWizard, ...overrides }}
      setData={setData}
      next={next}
      back={vi.fn()}
      templateBusy={false}
      templateError=""
      parseTemplate={vi.fn()}
    />,
  );
  return { setData, next };
}
describe('wizard and processing UI', () => {
  it('changes category and its document type together', async () => {
    const { setData } = setup(0);
    await userEvent.click(screen.getByRole('button', { name: 'SOP', exact: true }));
    expect(setData).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'work', docType: 'SOP', mappings: [] }),
    );
  });
  it('gates evidence before continuing', () => {
    setup(1);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
  it('requires a parsed, mapped custom template', () => {
    setup(3, { templateMode: 'custom' });
    expect(screen.getByRole('button', { name: 'Generate document' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Bring your own template/ })).toBeEnabled();
  });
  it('allows optional context and supports requirement chips', async () => {
    const { setData } = setup(2);
    await userEvent.click(screen.getByRole('button', { name: /Results table/ }));
    expect(setData).toHaveBeenCalledWith(expect.objectContaining({ brief: 'Results table' }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeEnabled();
  });
  it('places five stages immediately after the progress bar and uses the supplied ambient video', () => {
    render(
      <Processing
        status={{ status: 'processing', stage: 2, progress: 48, message: 'Ordering steps' }}
        upload={null}
        error=""
        busy
        cancelling={false}
        cancel={vi.fn()}
        retry={vi.fn()}
        recheck={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '48');
    const video = screen.getByTestId('processing-video');
    expect(video).toHaveAttribute('src', '/assets/scene.mp4');
    expect(video).toHaveAttribute('loop');
    expect(video).toHaveAttribute('playsinline');
    expect(screen.getByText(/SIMULATED PROGRESS/)).toBeInTheDocument();
  });
});
