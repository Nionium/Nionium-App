import React from 'react';
import { Dimensions, Linking } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Orientation from 'react-native-orientation-locker';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import RNScreens from 'react-native-screens';
import { Provider } from 'react-redux';
import Clipboard from '@react-native-clipboard/clipboard';

import AppContainer from './AppContainer';
import { appInit, appInitLocalSettings, setMasterDetail as setMasterDetailAction } from './actions/app';
import { deepLinkingOpen } from './actions/deepLinking';
import { ActionSheetProvider } from './containers/ActionSheet';
import InAppNotification from './containers/InAppNotification';
import Loading from './containers/Loading';
import Toast from './containers/Toast';
import TwoFactor from './containers/TwoFactor';
import { IThemePreference } from './definitions/ITheme';
import { DimensionsContext } from './dimensions';
import { MIN_WIDTH_MASTER_DETAIL_LAYOUT, colors, isFDroidBuild, themes } from './lib/constants';
import { getAllowAnalyticsEvents, getAllowCrashReport } from './lib/methods';
import { debounce, isTablet } from './lib/methods/helpers';
import { toggleAnalyticsEventsReport, toggleCrashErrorsReport } from './lib/methods/helpers/log';
import parseQuery from './lib/methods/helpers/parseQuery';
import {
	getTheme,
	initialTheme,
	newThemeState,
	setNativeTheme,
	subscribeTheme,
	unsubscribeTheme
} from './lib/methods/helpers/theme';
import { initializePushNotifications, onNotification } from './lib/notifications';
import { getInitialNotification } from './lib/notifications/videoConf/getInitialNotification';
import store from './lib/store';
import { initStore } from './lib/store/auxStore';
import { TSupportedThemes, ThemeContext } from './theme';
import ChangePasscodeView from './views/ChangePasscodeView';
import ScreenLockedView from './views/ScreenLockedView';
import NotificationSetupComponent from './lib/hooks/useFirebaseMessaging';
import RemoteNotifeeHandlersComponent from './lib/hooks/useRemoteNotifeeHandlers';

RNScreens.enableScreens();
initStore(store);

interface IDimensions {
	width: number;
	height: number;
	scale: number;
	fontScale: number;
}

interface IState {
	theme: TSupportedThemes;
	themePreferences: IThemePreference;
	width: number;
	height: number;
	scale: number;
	fontScale: number;
}

const parseDeepLinking = (url: string) => {
	if (url) {
		url = url.replace(/rocketchat:\/\/|https:\/\/go.rocket.chat\//, '');
		const regex = /^(room|auth|invite)\?/;
		if (url.match(regex)) {
			url = url.replace(regex, '').trim();
			if (url) {
				return parseQuery(url);
			}
		}
	}
	return null;
};

export default class Root extends React.Component<{}, IState> {
	private listenerTimeout!: any;

	constructor(props: any) {
		super(props);
		this.init();
		if (!isFDroidBuild) {
			this.initCrashReport();
		}
		const { width, height, scale, fontScale } = Dimensions.get('window');
		const theme = initialTheme();
		this.state = {
			theme: getTheme(theme),
			themePreferences: theme,
			width,
			height,
			scale,
			fontScale
		};
		if (isTablet) {
			this.initTablet();
			Orientation.unlockAllOrientations();
		} else {
			Orientation.lockToPortrait();
		}
		setNativeTheme(theme);
	}

	componentDidMount() {
		this.listenerTimeout = setTimeout(() => {
			Linking.addEventListener('url', ({ url }) => {
				const parsedDeepLinkingURL = parseDeepLinking(url);
				if (parsedDeepLinkingURL) {
					store.dispatch(deepLinkingOpen(parsedDeepLinkingURL));
				}
			});
		}, 5000);
		Dimensions.addEventListener('change', this.onDimensionsChange);
	}

	componentWillUnmount() {
		clearTimeout(this.listenerTimeout);
		Dimensions.removeEventListener('change', this.onDimensionsChange);

		unsubscribeTheme();
	}

	init = async () => {
		store.dispatch(appInitLocalSettings());

		// Open app from push notification
		const notification = await initializePushNotifications();
		if (notification) {
			onNotification(notification);
			return;
		}

		await getInitialNotification();

		// Open app from deep linking
		console.error('this is being called 22332');
		const deepLinking = await Linking.getInitialURL();
		console.error(deepLinking, 'yes this is a link');
		const parsedDeepLinkingURL = parseDeepLinking(deepLinking!);
		if (parsedDeepLinkingURL) {
			Clipboard.setString(JSON.stringify(parsedDeepLinkingURL));
			store.dispatch(deepLinkingOpen(parsedDeepLinkingURL));
			return;
		}

		// Open app from app icon
		store.dispatch(appInit());
	};

	getMasterDetail = (width: number) => {
		if (!isTablet) {
			return false;
		}
		return width > MIN_WIDTH_MASTER_DETAIL_LAYOUT;
	};

	setMasterDetail = (width: number) => {
		const isMasterDetail = this.getMasterDetail(width);
		store.dispatch(setMasterDetailAction(isMasterDetail));
	};

	// Dimensions update fires twice
	onDimensionsChange = debounce(({ window: { width, height, scale, fontScale } }: { window: IDimensions }) => {
		this.setDimensions({
			width,
			height,
			scale,
			fontScale
		});
		this.setMasterDetail(width);
	});

	setTheme = (newTheme = {}) => {
		// change theme state
		this.setState(
			prevState => newThemeState(prevState, newTheme as IThemePreference),
			() => {
				const { themePreferences } = this.state;
				// subscribe to Appearance changes
				subscribeTheme(themePreferences, this.setTheme);
			}
		);
	};

	setDimensions = ({ width, height, scale, fontScale }: IDimensions) => {
		this.setState({ width, height, scale, fontScale });
	};

	initTablet = () => {
		const { width } = this.state;
		this.setMasterDetail(width);
	};

	initCrashReport = () => {
		getAllowCrashReport().then(allowCrashReport => {
			toggleCrashErrorsReport(allowCrashReport);
		});
		getAllowAnalyticsEvents().then(allowAnalyticsEvents => {
			toggleAnalyticsEventsReport(allowAnalyticsEvents);
		});
	};

	render() {
		const { themePreferences, theme, width, height, scale, fontScale } = this.state;
		return (
			<SafeAreaProvider
				initialMetrics={initialWindowMetrics}
				style={{ backgroundColor: themes[this.state.theme].backgroundColor }}
			>
				<Provider store={store}>
					<ThemeContext.Provider
						value={{
							theme,
							themePreferences,
							setTheme: this.setTheme,
							colors: colors[theme]
						}}
					>
						<DimensionsContext.Provider
							value={{
								width,
								height,
								scale,
								fontScale,
								setDimensions: this.setDimensions
							}}
						>
							<GestureHandlerRootView style={{ flex: 1 }}>
								<ActionSheetProvider>
									<AppContainer />
									<TwoFactor />
									<ScreenLockedView />
									<ChangePasscodeView />
									<InAppNotification />
									<Toast />
									<Loading />
									{/* <NotificationSetupComponent />
									<RemoteNotifeeHandlersComponent /> */}
								</ActionSheetProvider>
							</GestureHandlerRootView>
						</DimensionsContext.Provider>
					</ThemeContext.Provider>
				</Provider>
			</SafeAreaProvider>
		);
	}
}
