"use client";
import {useParams} from "next/navigation";
import WorkspacePlaceholderPage from "../../../components/workspace-placeholder-page";
export default function ProfileSectionPage(){const p=useParams<{section:string}>();return <WorkspacePlaceholderPage routeKey={"profile/"+p.section}/>;}
