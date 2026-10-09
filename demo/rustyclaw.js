// These local examples exercise native form validation and resolved state without
// sending credentials, executing tools, or simulating a real authorization service.
for (const form of document.querySelectorAll('[data-rc-example]')) {
  form.addEventListener('submit', event => {
    event.preventDefault();
    const action = event.submitter?.value;
    const state = action === 'deny' ? 'denied' : 'complete';
    form.dataset.fcState = state;
    form.querySelector('[role="status"]').textContent =
      action === 'deny' ? 'Request denied.' : 'Example response recorded locally.';
    for (const control of form.querySelectorAll('input, button')) control.disabled = true;
  });
}
