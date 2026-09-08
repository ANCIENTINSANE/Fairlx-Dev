"use client";

import { Loader, LogOut, User } from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DottedSeparator } from "@/components/dotted-separator";
import { GithubAccountMenu } from "@/features/github-integration/components/github-account-menu";

import { useLogout } from "../api/use-logout";
import { useCurrent } from "../api/use-current";

export const UserButton = () => {
  const { data: user, isLoading } = useCurrent();
  const { mutate: logout } = useLogout();

  if (isLoading) {
    return (
      <div className="size-10 rounded-full flex items-center justify-center bg-muted border border-border">
        <Loader className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const { name, email } = user;

  const avatarFallback = name
    ? name.charAt(0).toUpperCase()
    : email.charAt(0).toUpperCase() ?? "U";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className="outline-none relative">
        <Avatar className="size-10 hover:opacity-75 transition border border-border">
          {user.prefs?.profileImageUrl && (
            <AvatarImage src={user.prefs.profileImageUrl} alt={name} />
          )}
          <AvatarFallback className="bg-muted font-medium text-muted-foreground flex items-center justify-center">
            {avatarFallback}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        className="w-72"
        sideOffset={10}
      >
        <div className="flex flex-col items-center justify-center gap-2 px-2.5 py-4">
          <Avatar className="size-[52px] border border-border">
            {user.prefs?.profileImageUrl && (
              <AvatarImage src={user.prefs.profileImageUrl} alt={name} />
            )}
            <AvatarFallback className="bg-muted text-xl font-medium text-muted-foreground flex items-center justify-center">
              {avatarFallback}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col items-center justify-center">
            <p className="text-sm font-medium text-foreground">
              {name || "User"}
            </p>
            <p className="text-xs text-muted-foreground">{email}</p>
          </div>
        </div>
        <DottedSeparator className="mb-1" />
        <GithubAccountMenu />
        <DottedSeparator className="mb-1" />
        <DropdownMenuItem asChild className="h-10 cursor-pointer">
          <Link href="/profile" className="flex items-center justify-center font-medium">
            <User className="size-4 mr-2" />
            Profile Settings
          </Link>
        </DropdownMenuItem>
        <DottedSeparator className="my-1" />
        <DropdownMenuItem
          onClick={() => logout()}
          className="h-10 flex items-center justify-center text-destructive font-medium cursor-pointer"
        >
          <LogOut className="size-4 mr-2" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
