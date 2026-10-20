const destinations = {
  home: '/pages/home/index',
  analysis: '/pages/library/index',
  chat: '/pages/chat/index',
  people: '/pages/archive/index',
  me: '/pages/account/index'
};

Component({
  properties: { selected: { type: String, value: 'home' } },
  methods: {
    open(event) {
      const target = event.currentTarget.dataset.target;
      if (!destinations[target] || this._navigating) return;
      // Return to an existing hub instead of stacking copies of the same page.
      const pages = getCurrentPages();
      const route = destinations[target].slice(1);
      const eligible = page => page.route === route && !(target === 'people' &&
        (page.options?.tab === 'self' || page.data?.archiveTab === 'self' || page.options?.subjectId || page.data?.selectedId));
      let index = -1;
      for (let position = pages.length - 1; position >= 0; position--) if (eligible(pages[position])) { index = position; break; }
      if (index === pages.length - 1 && index >= 0) return;
      this._navigating = true;
      const complete = () => { this._navigating = false; };
      if (index >= 0) {
        wx.navigateBack({ delta: pages.length - index - 1, complete });
      } else if (pages.length >= 9) {
        wx.redirectTo({ url: destinations[target], complete });
      } else {
        wx.navigateTo({ url: destinations[target], complete });
      }
    }
  }
});
