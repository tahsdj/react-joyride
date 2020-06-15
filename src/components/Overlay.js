import React from 'react';
import PropTypes from 'prop-types';
import treeChanges from 'tree-changes';

import {
  getClientRect,
  getDocumentHeight,
  getElement,
  getElementPosition,
  getScrollParent,
  hasCustomScrollParent,
  hasPosition,
} from '../modules/dom';
import { getBrowser, isLegacy, log } from '../modules/helpers';

import LIFECYCLE from '../constants/lifecycle';

import Spotlight from './Spotlight';

export default class JoyrideOverlay extends React.Component {
  _isMounted = false;
  state = {
    mouseOverSpotlight: false,
    isScrolling: false,
    showSpotlight: true,
  };

  static propTypes = {
    debug: PropTypes.bool.isRequired,
    disableOverlay: PropTypes.bool.isRequired,
    disableOverlayClose: PropTypes.bool,
    disableScrolling: PropTypes.bool.isRequired,
    disableScrollParentFix: PropTypes.bool.isRequired,
    lifecycle: PropTypes.string.isRequired,
    onClickOverlay: PropTypes.func.isRequired,
    placement: PropTypes.string.isRequired,
    spotlightClicks: PropTypes.bool.isRequired,
    spotlightPadding: PropTypes.number,
    styles: PropTypes.object.isRequired,
    target: PropTypes.oneOfType([PropTypes.object, PropTypes.string]).isRequired,
    group: PropTypes.bool,
  };

  static defaultProps = {
    group: false,
  };

  componentDidMount() {
    const { debug, disableScrolling, disableScrollParentFix, target } = this.props;
    const element = getElement(target);

    this.scrollParent = getScrollParent(element, disableScrollParentFix, true);
    this._isMounted = true;

    /* istanbul ignore else */
    if (!disableScrolling) {
      /* istanbul ignore else */
      if (process.env.NODE_ENV === 'development' && hasCustomScrollParent(element, true)) {
        log({
          title: 'step has a custom scroll parent and can cause trouble with scrolling',
          data: [{ key: 'parent', value: this.scrollParent }],
          debug,
        });
      }
    }

    window.addEventListener('resize', this.handleResize);
  }

  componentDidUpdate(prevProps) {
    const { lifecycle, spotlightClicks } = this.props;
    const { changed, changedTo } = treeChanges(prevProps, this.props);

    /* istanbul ignore else */
    if (changedTo('lifecycle', LIFECYCLE.TOOLTIP)) {
      this.scrollParent.addEventListener('scroll', this.handleScroll, { passive: true });

      setTimeout(() => {
        const { isScrolling } = this.state;

        if (!isScrolling) {
          this.updateState({ showSpotlight: true });
        }
      }, 100);
    }

    if (changed('spotlightClicks') || changed('disableOverlay') || changed('lifecycle')) {
      if (spotlightClicks && lifecycle === LIFECYCLE.TOOLTIP) {
        window.addEventListener('mousemove', this.handleMouseMove, false);
      } else if (lifecycle !== LIFECYCLE.TOOLTIP) {
        window.removeEventListener('mousemove', this.handleMouseMove);
      }
    }
  }

  componentWillUnmount() {
    this._isMounted = false;

    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('resize', this.handleResize);

    clearTimeout(this.resizeTimeout);
    clearTimeout(this.scrollTimeout);
    this.scrollParent.removeEventListener('scroll', this.handleScroll);
  }

  getGroupStyles = elements => {
    const { showSpotlight } = this.state;
    const { spotlightClicks, spotlightPadding, styles } = this.props;

    const elementsSortedByPosY = [...elements].sort(
      (el1, el2) => el1.getBoundingClientRect().y - el2.getBoundingClientRect().y,
    );
    const elementsSortedByPosX = [...elements].sort(
      (el1, el2) => el1.getBoundingClientRect().x - el2.getBoundingClientRect().x,
    );

    const topElementPos = elementsSortedByPosY[0].getBoundingClientRect();
    const bottomElementPos = elementsSortedByPosY[
      elementsSortedByPosY.length - 1
    ].getBoundingClientRect();

    const leftElementPos = elementsSortedByPosX[0].getBoundingClientRect();
    const rightElementPos = elementsSortedByPosX[
      elementsSortedByPosX.length - 1
    ].getBoundingClientRect();

    const height =
      bottomElementPos.y - topElementPos.y + bottomElementPos.height + spotlightPadding * 2;
    const width =
      rightElementPos.x - leftElementPos.x + rightElementPos.width + spotlightPadding * 2;

    const isFixedTarget = hasPosition(elements[0]);

    return [
      {
        ...(isLegacy() ? styles.spotlightLegacy : styles.spotlight),
        height: Math.round(height),
        left: Math.round(leftElementPos.x - spotlightPadding),
        opacity: showSpotlight ? 1 : 0,
        pointerEvents: spotlightClicks ? 'none' : 'auto',
        position: isFixedTarget ? 'fixed' : 'absolute',
        top: topElementPos.y - spotlightPadding,
        transition: 'opacity 0.2s',
        width: Math.round(width),
      },
    ];
  };

  get spotlightStyles() {
    const { showSpotlight } = this.state;
    const {
      disableScrollParentFix,
      spotlightClicks,
      spotlightPadding,
      styles,
      target,
      group,
      paddingSize,
    } = this.props;

    const elements = (() => {
      if (typeof target === 'string') return [...document.querySelectorAll(target)];
      if (Array.isArray(target)) {
        return target.reduce(
          (elements, t) =>
            typeof t === 'string'
              ? [...elements, ...document.querySelectorAll(t)]
              : [...elements, getElement(t)],
          [],
        );
      }
      return [];
    })();

    const padding = (() => {
      switch (paddingSize) {
        case 'small':
          return [4, 8];
        case 'mid':
          return [8, 12];
        case 'large':
          return [12, 16];
        default:
          return [8, 12];
      }
    })();

    if (!group || elements.length < 2) {
      return elements.map(element => {
        const elementRect = getClientRect(element);
        const isFixedTarget = hasPosition(element);
        const top = getElementPosition(element, padding[1], disableScrollParentFix);

        return {
          ...(isLegacy() ? styles.spotlightLegacy : styles.spotlight),
          height: Math.round(elementRect.height + padding[1] * 2),
          left: Math.round(elementRect.left - padding[0]),
          opacity: showSpotlight ? 1 : 0,
          pointerEvents: spotlightClicks ? 'none' : 'auto',
          position: isFixedTarget ? 'fixed' : 'absolute',
          top,
          transition: 'opacity 0.2s',
          width: Math.round(elementRect.width + padding[0] * 2),
        };
      });
    }

    return this.getGroupStyles(elements);
  }

  handleMouseMove = e => {
    const { mouseOverSpotlight } = this.state;

    const isInAnySpotLight = this.spotlightStyles.some(spotlightStyle => {
      const { height, left, position, top, width } = spotlightStyle;

      const offsetY = position === 'fixed' ? e.clientY : e.pageY;
      const offsetX = position === 'fixed' ? e.clientX : e.pageX;
      const inSpotlightHeight = offsetY >= top && offsetY <= top + height;
      const inSpotlightWidth = offsetX >= left && offsetX <= left + width;
      const inSpotlight = inSpotlightWidth && inSpotlightHeight;

      return inSpotlight;
    });

    if (isInAnySpotLight !== mouseOverSpotlight) {
      this.updateState({ mouseOverSpotlight: isInAnySpotLight });
    }
  };

  handleScroll = () => {
    const { target } = this.props;
    const elements = (() => {
      if (typeof target === 'string') return [...document.querySelectorAll(target)];
      if (Array.isArray(target)) {
        return target.reduce(
          (elements, t) =>
            typeof t === 'string'
              ? [...elements, ...document.querySelectorAll(t)]
              : [...elements, getElement(t)],
          [],
        );
      }
      return [];
    })();

    if (this.scrollParent !== document) {
      const { isScrolling } = this.state;

      if (!isScrolling) {
        this.updateState({ isScrolling: true, showSpotlight: false });
      }

      clearTimeout(this.scrollTimeout);

      this.scrollTimeout = setTimeout(() => {
        this.updateState({ isScrolling: false, showSpotlight: true });
      }, 50);
    } else if (elements.find(element => hasPosition(element, 'sticky'))) {
      this.updateState({});
    }
  };

  handleResize = () => {
    clearTimeout(this.resizeTimeout);

    this.resizeTimeout = setTimeout(() => {
      if (!this._isMounted) {
        return;
      }

      this.forceUpdate();
    }, 100);
  };

  updateState(state) {
    if (!this._isMounted) {
      return;
    }

    this.setState(state);
  }

  render() {
    const { mouseOverSpotlight, showSpotlight } = this.state;
    const {
      disableOverlay,
      disableOverlayClose,
      lifecycle,
      onClickOverlay,
      placement,
      styles,
    } = this.props;

    if (disableOverlay || lifecycle !== LIFECYCLE.TOOLTIP) {
      return null;
    }

    let baseStyles = styles.overlay;

    /* istanbul ignore else */
    if (isLegacy()) {
      baseStyles = placement === 'center' ? styles.overlayLegacyCenter : styles.overlayLegacy;
    }

    const stylesOverlay = {
      cursor: disableOverlayClose ? 'default' : 'pointer',
      height: getDocumentHeight(),
      pointerEvents: mouseOverSpotlight ? 'none' : 'auto',
      ...baseStyles,
    };

    const spotlights = this.spotlightStyles.map((spotlightStyles, index) => {
      let spotlight = placement !== 'center' && showSpotlight && (
        <Spotlight styles={spotlightStyles} key={index} />
      );

      // Hack for Safari bug with mix-blend-mode with z-index
      if (getBrowser() === 'safari') {
        const { mixBlendMode, zIndex, ...safarOverlay } = stylesOverlay;

        spotlight = (
          <div style={{ ...safarOverlay }} key={index}>
            {spotlight}
          </div>
        );
        delete stylesOverlay.backgroundColor;
      }

      return spotlight;
    });

    return (
      <div className="react-joyride__overlay" style={stylesOverlay} onClick={onClickOverlay}>
        {spotlights}
      </div>
    );
  }
}
