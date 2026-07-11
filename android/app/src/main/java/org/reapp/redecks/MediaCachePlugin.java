package org.reapp.redecks;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Мост управления файловым кэшем медиа. */
@CapacitorPlugin(name = "MediaCache")
public class MediaCachePlugin extends Plugin {

    @Override
    public void load() {
        MediaCache.init(getContext().getApplicationContext());
    }

    @PluginMethod
    public void getConfig(PluginCall call) {
        JSObject r = new JSObject();
        r.put("enabled", MediaCache.isEnabled());
        r.put("limitMb", MediaCache.getLimitMb());
        r.put("usageBytes", MediaCache.getUsage());
        call.resolve(r);
    }

    @PluginMethod
    public void setConfig(PluginCall call) {
        Boolean enabledB = call.getBoolean("enabled", MediaCache.isEnabled());
        boolean enabled = enabledB != null && enabledB;
        Integer mbI = call.getInt("limitMb", MediaCache.getLimitMb());
        int mb = mbI == null ? MediaCache.getLimitMb() : mbI;

        MediaCache.setLimitMb(mb);   // клампится внутри и вытесняет лишнее
        MediaCache.setEnabled(enabled);

        JSObject r = new JSObject();
        r.put("enabled", MediaCache.isEnabled());
        r.put("limitMb", MediaCache.getLimitMb());
        r.put("usageBytes", MediaCache.getUsage());
        call.resolve(r);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        MediaCache.clear();
        JSObject r = new JSObject();
        r.put("usageBytes", MediaCache.getUsage());
        call.resolve(r);
    }
}
